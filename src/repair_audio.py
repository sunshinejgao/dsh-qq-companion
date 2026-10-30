#!/usr/bin/env python
"""
逐帧修复 RVC 翻唱人声：卡壳（掉帧/静音）、爆音（click）、杂音（底噪）、音量不均。

思路是「先逐帧诊断，再只改有问题的地方」，不做全局 EQ 那种一刀切：
  1) 分帧（10ms 帧 / 5ms 跳）算 RMS 与谱质心，找出：
     - 掉帧：孤立帧能量骤降（前后都在唱，中间突然没声） → 用两侧交叉淡入补上
     - 爆音：样本级二阶差分尖峰 → 用线性插值抹掉
  2) 谱减降噪（noisereduce，非平稳），只在本地低能量帧上做
  3) 轻度声门/齿音处理：4.5~8k 动态压制（de-esser）
  4) 输出前做软限幅，避免削波

用法：python repair_audio.py -i in.wav -o out.wav [--report]
"""
import argparse
import json
import sys

import numpy as np
import soundfile as sf


def stft_denoise(y, sr):
    try:
        import noisereduce as nr

        return nr.reduce_noise(y=y, sr=sr, stationary=False, prop_decrease=0.75)
    except Exception as e:
        print(f"[warn] 降噪跳过：{e}", file=sys.stderr)
        return y


def repair_dropouts(y, sr, frame_ms=10.0, hop_ms=5.0, ratio=0.12, max_frac=0.03):
    """掉帧：一帧能量远低于邻域且邻域有声 → 用邻域交叉淡入填补。
    宁可漏修也不能多修：命中帧数超过总帧数 max_frac 就判定为误检，直接放弃。"""
    frame = int(sr * frame_ms / 1000)
    hop = int(sr * hop_ms / 1000)
    n = 1 + max(0, (len(y) - frame) // hop)
    rms = np.array([np.sqrt(np.mean(y[i * hop:i * hop + frame] ** 2) + 1e-12) for i in range(n)])
    med = np.median(rms)
    cand = []
    win = 40  # 前后各看 400ms
    for i in range(win, n - win):
        local = np.median(rms[max(0, i - win):i + win])
        if local < med * 0.12:
            continue
        if rms[i] < local * ratio:
            cand.append(i)
    if len(cand) > n * max_frac:
        return y, -len(cand), n
    out = y.copy()
    fixed = 0
    for i in cand:
        s = i * hop
        e = min(len(out), s + frame)
        left = out[max(0, s - hop):s]
        right = out[e:e + hop]
        if len(left) < 16 or len(right) < 16:
            continue
        seg = np.linspace(left[-1], right[0], e - s)
        out[s:e] = out[s:e] * 0.2 + seg * 0.8
        fixed += 1
    return out, fixed, n


def repair_clicks(y, sr, thresh_ratio=60.0, max_repairs=400):
    """爆音：样本级二阶差分尖峰，替换为线性插值。
    真爆音是稀疏的；命中超过 max_repairs 说明阈值太低，判定误检直接放弃。"""
    d2 = np.abs(np.diff(y, n=2))
    if d2.size == 0:
        return y, 0
    thr = np.median(d2) * thresh_ratio + 1e-6
    idx = np.where(d2 > thr)[0]
    if len(idx) > max_repairs:
        return y, -len(idx)
    out = y.copy()
    fixed = 0
    span = max(2, int(sr * 0.002))
    for i in idx:
        a = max(0, i - span)
        b = min(len(out) - 1, i + span)
        if b - a < 3:
            continue
        out[a:b] = np.linspace(out[a], out[b], b - a)
        fixed += 1
    return out, fixed


def deess(y, sr, low=4500, high=8000, reduce_db=3.0):
    """齿音/刺耳：4.5~8k 做动态衰减（用简单带通能量包络控制）。"""
    from scipy.signal import butter, sosfilt

    sos = butter(4, [low / (sr / 2), high / (sr / 2)], btype="band", output="sos")
    band = sosfilt(sos, y)
    env = np.abs(band)
    # 平滑包络
    k = max(1, int(sr * 0.01))
    kern = np.ones(k) / k
    env = np.convolve(env, kern, mode="same")
    thr = np.percentile(env, 92) + 1e-9
    gain = np.ones_like(env)
    mask = env > thr
    gain[mask] = 10 ** (-reduce_db / 20)
    # 平滑增益，避免抽气
    gain = np.convolve(gain, kern, mode="same")
    return y - band * (1 - gain), int(mask.sum())


def limiter(y, ceiling=0.97):
    peak = np.max(np.abs(y)) + 1e-9
    if peak > ceiling:
        y = y * (ceiling / peak)
    return np.tanh(y * 1.02) / np.tanh(1.02)


def _fill_short_gaps(mask, max_gap):
    """把 mask 里短于 max_gap 帧的 False 段填成 True（句内换气不该切）。"""
    out = mask.copy()
    i, n = 0, len(mask)
    while i < n:
        if not mask[i]:
            j = i
            while j < n and not mask[j]:
                j += 1
            if (j - i) <= max_gap and i > 0 and j < n:
                out[i:j] = True
            i = j
        else:
            i += 1
    return out


def _remove_short_runs(mask, min_run):
    """把短于 min_run 帧的 True 段去掉（孤立的爆点/咔哒）。"""
    out = mask.copy()
    i, n = 0, len(mask)
    while i < n:
        if mask[i]:
            j = i
            while j < n and mask[j]:
                j += 1
            if (j - i) < min_run:
                out[i:j] = False
            i = j
        else:
            i += 1
    return out


def gate_by_reference(y, sr, ref_path, floor_db=-70.0, smooth_ms=30.0, ratio=0.32):
    """用原始人声（分离出来的那条）当门限：原唱没声的地方把转换结果压掉。

    RVC 在静音段会“脑补”出噪声/气声，混伴奏后就是前奏里的杂音。
    按参考人声的包络做软门限：参考静音 → 输出衰减到 floor_db，参考有声 → 1。
    过渡用 30ms 平滑，避免抽气声。
    """
    from scipy.signal import resample_poly

    ref, ref_sr = sf.read(ref_path, always_2d=False, dtype="float32")
    if ref.ndim > 1:
        ref = ref.mean(axis=1)
    if ref_sr != sr:
        ref = resample_poly(ref, sr, ref_sr).astype("float32")

    hop = max(1, int(sr * 0.01))
    n = 1 + max(0, (len(ref) - hop) // hop)
    env = np.array([np.sqrt(np.mean(ref[i * hop:(i + 1) * hop] ** 2) + 1e-12) for i in range(n)])
    # 自适应阈值：用「静音底噪(p10)」和「正常演唱电平(p60)」插值，
    # 比固定比例靠谱——固定 90 分位的比例会把轻声段落整段切掉。
    # 先做 200ms 平滑：短促的分离残留（吉他/呼吸）会被抹平，
    # 真正的演唱是持续的，平滑后仍然远高于阈值。
    smooth_n = max(1, int(0.45 / 0.01))
    env = np.convolve(env, np.ones(smooth_n) / smooth_n, mode="same")
    p10 = float(np.percentile(env, 10))
    p60 = float(np.percentile(env, 60))
    thr = p10 + 0.12 * max(p60 - p10, 1e-9)

    # 门限策略：先划出「这首歌有人在唱」的总区间，区间内只掐掉长静音。
    # 原因：前奏的分离残留（0.005~0.008）和主歌轻声辅音（~0.01）电平重叠，
    # 单靠能量阈值必然二选一——要么前奏有杂音，要么密集咬字被切得断断续续。
    coarse_n = max(1, int(0.45 / 0.01))
    coarse = np.convolve(env, np.ones(coarse_n) / coarse_n, mode="same")
    # 用「明显在唱」的电平来定起止，前奏里那点分离残留达不到这个高度
    thr_strong = p10 + 0.35 * max(p60 - p10, 1e-9)
    active = coarse >= thr_strong

    idx_active = np.where(active)[0]
    if len(idx_active) == 0:
        mask = np.zeros(len(env), dtype=bool)
    else:
        first = max(0, int(idx_active[0]) - int(0.3 / 0.01))
        last = min(len(env) - 1, int(idx_active[-1]) + int(0.5 / 0.01))
        mask = np.zeros(len(env), dtype=bool)
        mask[first:last + 1] = True
        # 区间内只补长静音（>1.5s 的间奏），句内停顿原样保留
        mask = _fill_short_gaps(mask, int(1.5 / 0.01))
    gain = np.where(mask, 1.0, 10 ** (floor_db / 20))

    k = max(1, int(smooth_ms / 10))
    gain = np.convolve(gain, np.ones(k) / k, mode="same")

    g = np.repeat(gain, hop)[: len(y)]
    if len(g) < len(y):
        g = np.pad(g, (0, len(y) - len(g)), constant_values=float(gain[-1]) if len(gain) else 1.0)
    y = y * g

    # 时间门限之后还残留的“沙沙”噪声：用参考静音帧估一个噪声谱，做谱减
    y = spectral_subtract_from_gate(y, sr, gain, hop)
    return y, int((gain < 0.5).sum()), len(gain)


def spectral_subtract_from_gate(y, sr, gain, hop, over=1.15, floor=0.06):
    """用「参考静音但输出有声」的帧估噪声谱，然后做谱减。

    时间门限只能压幅度，压不干净；谱减能把 RVC 在静音段“脑补”出来的那份
    频谱（气声/沙沙声）减掉，正片人声基本不受影响。
    """
    n_fft = 1024
    win = np.hanning(n_fft).astype("float32")
    hop_s = n_fft // 4
    if len(y) < n_fft:
        return y
    frames = 1 + (len(y) - n_fft) // hop_s
    S = np.empty((frames, n_fft // 2 + 1), dtype="complex64")
    for i in range(frames):
        seg = y[i * hop_s:i * hop_s + n_fft] * win
        S[i] = np.fft.rfft(seg)
    mag = np.abs(S)

    # 把时间门限的 gain 映射到 STFT 帧索引
    idx = np.clip((np.arange(frames) * hop_s) // hop, 0, len(gain) - 1)
    silent = gain[idx] < 0.5
    if silent.sum() < 5:
        return y
    noise = np.mean(mag[silent], axis=0)

    cleaned = np.maximum(mag - over * noise[None, :], floor * mag)
    phase = S / (mag + 1e-9)
    S2 = cleaned * phase
    out = np.zeros(len(y), dtype="float32")
    wsum = np.zeros(len(y), dtype="float32")
    for i in range(frames):
        seg = np.fft.irfft(S2[i]).astype("float32") * win
        out[i * hop_s:i * hop_s + n_fft] += seg
        wsum[i * hop_s:i * hop_s + n_fft] += win ** 2
    wsum[wsum < 1e-6] = 1.0
    return out / wsum


def fill_short_gaps(y, sr, ref_path, max_gap_ms=80, loud=0.10, quiet=0.025):
    """把「参考有声、输出突然变安静」的短缝（≤max_gap_ms）用前后波形交叉淡化补上。

    只补短缝：长了就说明是真的换气或停顿，补了会假。
    返回 (新波形, 补了多少段, 补了多少毫秒)。
    """
    import soundfile as sf_local
    from scipy.signal import resample_poly

    ref, rsr = sf_local.read(ref_path, always_2d=False, dtype="float32")
    if ref.ndim > 1:
        ref = ref.mean(axis=1)
    if rsr != sr:
        ref = resample_poly(ref, sr, rsr).astype("float32")

    hop = max(1, int(sr * 0.01))
    n = 1 + max(0, (min(len(y), len(ref)) - hop) // hop)
    if n < 3:
        return y, 0, 0
    env_y = np.array([np.sqrt(np.mean(y[i * hop:(i + 1) * hop] ** 2)) for i in range(n)])
    env_r = np.array([np.sqrt(np.mean(ref[i * hop:(i + 1) * hop] ** 2)) for i in range(n)])

    hit = (env_r > loud) & (env_y < quiet)
    max_frames = max(1, int(max_gap_ms / 10))
    filled = 0
    filled_ms = 0.
    i = 0
    while i < n:
        if not hit[i]:
            i += 1
            continue
        j = i
        while j < n and hit[j]:
            j += 1
        run = j - i
        # 只补短缝，而且前后必须有足够的真实音频可借
        if run <= max_frames and i >= run and j + run <= n:
            a = i * hop
            b = j * hop
            gap = b - a
            pre = y[a - gap:a].copy()
            post = y[b:b + gap].copy()
            if len(pre) == gap and len(post) == gap:
                ramp = np.linspace(0.0, 1.0, gap, dtype="float32")
                filler = pre * (1.0 - ramp) + post * ramp
                # 进出两端各做 5ms 淡入淡出，避免接缝"咔"一声
                edge = max(1, int(sr * 0.005))
                if gap > edge * 2:
                    filler[:edge] *= np.linspace(0, 1, edge, dtype="float32")
                    filler[-edge:] *= np.linspace(1, 0, edge, dtype="float32")
                y[a:b] = filler
                filled += 1
                filled_ms += run * 10
        i = j
    return y, filled, int(filled_ms)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-i", "--input", required=True)
    ap.add_argument("-o", "--output", required=True)
    ap.add_argument("--no-denoise", action="store_true")
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--gate-ref", default="", help="原始人声 wav；给了就按它的能量做静音门限（压掉前奏杂音）")
    ap.add_argument("--fill-gaps", action="store_true", help="配合 --gate-ref：把参考有声但输出断掉的短缝补上")
    ap.add_argument("--max-gap-ms", type=int, default=80, help="最多补多长的缝（毫秒），默认 80")
    args = ap.parse_args()

    y, sr = sf.read(args.input, always_2d=False, dtype="float32")
    if y.ndim > 1:
        y = y.mean(axis=1)
    stats = {"sr": sr, "dur": round(len(y) / sr, 2)}

    y, n_drop, n_frames = repair_dropouts(y, sr)
    stats["frames"] = n_frames
    stats["dropouts_fixed"] = n_drop

    y, n_click = repair_clicks(y, sr)
    stats["clicks_fixed"] = n_click

    if not args.no_denoise:
        y = stft_denoise(y, sr)

    if args.gate_ref:
        y, muted, total_frames = gate_by_reference(y, sr, args.gate_ref)
        stats["gate_ref"] = args.gate_ref
        stats["gated_frames"] = f"{muted}/{total_frames}"
        if args.fill_gaps:
            y, n_fill, ms_fill = fill_short_gaps(y, sr, args.gate_ref, max_gap_ms=args.max_gap_ms)
            stats["gaps_filled"] = n_fill
            stats["gaps_filled_ms"] = ms_fill

    y, n_ess = deess(y, sr)
    stats["deessed_frames"] = n_ess

    y = limiter(y)
    sf.write(args.output, y, sr, subtype="PCM_16")
    stats["out"] = args.output
    print(json.dumps(stats, ensure_ascii=False))


if __name__ == "__main__":
    main()
