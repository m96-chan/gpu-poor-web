# gpu-poor-web

**Running LLMs that don't fit in your VRAM — in the browser, anyway.**

Started from a dumb thought: if [AirLLM](https://github.com/lyogavin/airllm) (layer-paged inference that squeezes a 70B through a 4GB GPU) could be ported to WebGPU... you wouldn't need an LLM server at all, would you? This is the research repo for taking that thought seriously.

> Status: research. Nothing runs yet.

## The physics you don't get to argue with

With layer paging, decoding one token = streaming the entire model's weights from storage into the GPU. The floor is storage bandwidth:

| model | int8 size | floor at 2–4 GB/s effective NVMe→GPU |
|---|---|---|
| 8B | ~8 GB | 2–4 s/token |
| 70B (int4) | ~35 GB | 10–20 s/token |
| 70B (fp16) | 140 GB | [~20 s/token even on a Gen4 NVMe at 7 GB/s](https://umesh-malik.com/blog/run-70b-llm-on-4gb-gpu-airllm) |

**As chat latency, this is dead on arrival.** The point of this repo is to accept that, then hunt for the use cases where it isn't dead — and the variants that don't die.

## Prior art (surveyed 2026-08)

- **No project claiming an AirLLM-style browser/WebGPU port was found.** The niche is open
- [Llamas on the Web](https://arxiv.org/html/2605.20706v1) (the paper behind llama.cpp's WebGPU backend): streams weights OPFS→WebGPU through small staging buffers — but for **load-time** memory efficiency, not per-token paging of larger-than-VRAM models
- [Layer-wise inferencing + batching](https://verdagon.dev/blog/llm-throughput-not-ram-limited): layer paging achieves real **throughput with large batches** (one layer load amortized across many sequences). It can't save latency, but batch workloads survive — a key observation
- [WebLLM](https://github.com/mlc-ai/web-llm), wllama, and friends all live in the "fits in VRAM" world. This repo is about what's outside it

## Research roadmap

1. **E1: Measure the bandwidth** — real-browser throughput of FSA (File System Access) / OPFS → ArrayBuffer → `writeBuffer`. The denominator of every argument here
2. **E2: Layer-paging skeleton** — on top of [web-xpu-ops](https://github.com/m96-chan/web-xpu-ops) (WGSL ops + a resident llama-arch engine), build an executor whose weights are *non*-resident: streamed layer-by-layer from FSA. Establish "works, correct, slow" on a ~3B first
3. **E3: Batch-throughput mode** — run it as batch processing (data generation, summarization, memory consolidation), not conversation. Example use: a character-chat site whose mascot "sleeps" at night — the browser runs big-model batch jobs during the unattended hours
4. **E4: MoE expert paging (the real prize)** — instead of streaming a dense model whole, stream only a sparse MoE's **active experts**. A 671B MoE moves less data per token than a 70B dense. Keep hot experts resident in VRAM (LRU), page cold ones from FSA. If this works, "GPU-poor runs a frontier-class MoE in a browser tab" comes into view

## Related

- [web-xpu-ops](https://github.com/m96-chan/web-xpu-ops) — WGSL primitive ops, a real-GPU test harness, and a resident llama-arch engine (the foundation this builds on)
- Inspiration: [AirLLM](https://github.com/lyogavin/airllm)
