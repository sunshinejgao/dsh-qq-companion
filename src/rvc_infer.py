#!/usr/bin/env python
"""
RVC 推理包装：输入一段 wav，输出换成 woyanisha08 音色的 wav。

用法：
  python rvc_infer.py -i in.wav -o out.wav [-m 模型.pth] [--device cpu:0]

为什么是单独一个文件：rvc_python 的 API 在导入时会拉 fairseq/hubert，
放在 node 里调不方便；这里只做一件小事，出错也好定位。
"""
import argparse
import os
import sys

MODEL_DIR = r"D:\QQ\voice-models\woyanisha08"
MODEL_PTH = os.path.join(MODEL_DIR, "woyanisha08.pth")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-i", "--input", required=True)
    ap.add_argument("-o", "--output", required=True)
    ap.add_argument("-m", "--model", default=MODEL_PTH)
    ap.add_argument("--device", default="cpu:0", help="cpu:0 或 cuda:0")
    ap.add_argument("--pitch", type=int, default=0, help="变调半音数，0=不变")
    ap.add_argument("--index-rate", type=float, default=0.75)
    ap.add_argument("--f0", default="rmvpe")
    args = ap.parse_args()

    for p in (args.input, args.model):
        if not os.path.exists(p):
            print(f"缺少文件：{p}", file=sys.stderr)
            return 2

    from rvc_python.infer import RVCInference

    rvc = RVCInference(device=args.device)
    rvc.set_models_dir(os.path.dirname(args.model))
    index_path = ""
    for f in os.listdir(os.path.dirname(args.model)):
        if f.endswith(".index"):
            index_path = os.path.join(os.path.dirname(args.model), f)
            break
    # load_model 支持直接给路径；给名字反而会在 models_dir 里找不到
    rvc.load_model(args.model, index_path=index_path)
    try:
        rvc.set_params(f0method=args.f0, f0up_key=args.pitch, index_rate=args.index_rate)
    except Exception as e:
        print(f"[warn] set_params 部分参数没生效：{e}", file=sys.stderr)

    rvc.infer_file(args.input, args.output)
    if not os.path.exists(args.output) or os.path.getsize(args.output) < 1000:
        print("推理没有产出有效音频", file=sys.stderr)
        return 3
    print(f"OK {args.output} {os.path.getsize(args.output)//1024}KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
