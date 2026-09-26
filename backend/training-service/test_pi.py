import asyncio
from core.acg.strategies import StrategyHandler
from core.acg.db import LexiconMiner

class DummyLLM:
    async def generate_sentences(self, *args, **kwargs): return {}
    async def generate_carrier_phrases(self, *args, **kwargs): return []

async def main():
    miner = LexiconMiner()
    llm = DummyLLM()
    handler = StrategyHandler(miner, llm)
    
    res = await handler.phoneme_isolation(
        targets=["f"],
        diag="articulation",
        lang="english",
        diff=1,
        struct="CVC",
        forbidden=[],
        position_idx=0
    )
    import json
    print(json.dumps(res, indent=2))

asyncio.run(main())
