import asyncio, sys, edge_tts

async def main():
    text, out = sys.argv[1], sys.argv[2]
    voice = sys.argv[3] if len(sys.argv) > 3 else "zh-CN-XiaoyiNeural"
    rate = sys.argv[4] if len(sys.argv) > 4 else "+0%"
    pitch = sys.argv[5] if len(sys.argv) > 5 else "+0Hz"
    c = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
    await c.save(out)

if __name__ == "__main__":
    asyncio.run(main())
