#!/usr/bin/env python
"""
常驻的 RVC 推理服务：模型只加载一次，之后每次转换几秒钟。
mcp-diary 的 voice_say 会先打这个服务（127.0.0.1:8127），连不上才退回自己起进程。

启动：D:\\QQ\\voice-env\\Scripts\\python.exe D:\\MyCode\\Python\\work\\bilibili\\tools\\rvc_server.py
接口：POST /convert  {"in": "xxx.wav", "out": "yyy.wav", "pitch": 0, "index_rate": 0.75}
     GET  /health   -> {"ok": true, "model": "..."}
"""
import json
import os
import sys
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

os.environ.setdefault("RVC_SKIP_DOWNLOAD", "1")

# 模型与端口都走环境变量，默认值只是"本地开发能跑起来"的兜底
MODEL_ROOT = os.environ.get("RVC_MODELS_DIR") or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "voice-models")
DEFAULT_MODEL = os.environ.get("RVC_MODEL", "naxida")
PORT = int(os.environ.get("RVC_PORT", "8127"))

_rvc = None
_current = None
_index = ""


def model_dir(name):
    d = os.path.join(MODEL_ROOT, name)
    return d if os.path.isdir(d) else os.path.join(MODEL_ROOT, DEFAULT_MODEL)


def load(name=None):
    """加载（或切换）音色模型；同一个模型重复调用直接复用。"""
    global _rvc, _current, _index
    want = name or _current or DEFAULT_MODEL
    if _rvc is not None and _current == want:
        return _rvc
    d = model_dir(want)
    pth = None
    for f in os.listdir(d):
        if f.endswith(".pth"):
            pth = os.path.join(d, f)
            idx = [x for x in os.listdir(d) if x.endswith(".index")]
            _index = os.path.join(d, idx[0]) if idx else ""
            break
    if not pth:
        if _rvc is not None:
            return _rvc
        raise RuntimeError(f"模型目录里没有 .pth：{d}")
    from rvc_python.infer import RVCInference

    if _rvc is None:
        _rvc = RVCInference(device="cpu:0")
    _rvc.set_models_dir(d)
    _rvc.load_model(pth, index_path=_index)
    _current = want
    return _rvc


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/health"):
            return self._json(200, {"ok": _rvc is not None, "model": _current or DEFAULT_MODEL})
        self._json(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        if not self.path.startswith("/convert"):
            return self._json(404, {"ok": False})
        n = int(self.headers.get("Content-Length", 0))
        try:
            req = json.loads(self.rfile.read(n) or b"{}")
            src, dst = req["in"], req["out"]
            if not os.path.exists(src):
                return self._json(400, {"ok": False, "error": f"找不到输入：{src}"})
            rvc = load(req.get("model"))
            t0 = time.time()
            try:
                rvc.set_params(
                    f0method=req.get("f0", "rmvpe"),
                    f0up_key=int(req.get("pitch", 0)),
                    index_rate=float(req.get("index_rate", 0.6)),
                    protect=float(req.get("protect", 0.45)),
                    rms_mix_rate=float(req.get("rms", 0.75)),
                    filter_radius=int(req.get("filter_radius", 3)),
                )
            except Exception as e:
                print("set_params warn:", e, flush=True)
            rvc.infer_file(src, dst)
            if not os.path.exists(dst) or os.path.getsize(dst) < 1000:
                return self._json(500, {"ok": False, "error": "输出为空"})
            return self._json(200, {"ok": True, "sec": round(time.time() - t0, 2), "size": os.path.getsize(dst)})
        except Exception as e:
            return self._json(500, {"ok": False, "error": str(e), "trace": traceback.format_exc()[-500:]})


if __name__ == "__main__":
    print(f"loading model: {DEFAULT_MODEL}", flush=True)
    t0 = time.time()
    load()
    print(f"model ready in {time.time() - t0:.1f}s, listening on 127.0.0.1:{PORT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
