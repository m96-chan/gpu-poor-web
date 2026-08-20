# gpu-poor-web

**VRAMに収まらないLLMを、ブラウザで、それでも回す研究。**

[AirLLM](https://github.com/lyogavin/airllm)(レイヤー単位ページングで4GB GPUに70Bを通すやつ)をWebGPUに持ち込んだらLLMサーバー要らなくなくね？ という思いつきから始まったバカ研究リポジトリ。真面目にやります。

> Status: 研究段階。動くものはまだ無い。

## 前提となる物理

レイヤーページング方式のデコード1トークン = モデル全重みをストレージ→GPUに流す。つまり床はストレージ帯域で決まる:

| モデル | int8サイズ | NVMe→GPU実効 2〜4GB/s での床 |
|---|---|---|
| 8B | 〜8GB | 2〜4秒/トークン |
| 70B (int4) | 〜35GB | 10〜20秒/トークン |
| 70B (fp16) | 140GB | [〜20秒/トークン(Gen4 NVMe 7GB/sでも)](https://umesh-malik.com/blog/run-70b-llm-on-4gb-gpu-airllm) |

**チャットの対話レイテンシとしては死んでいる。** これを認めた上で、死んでいない使い道と、死なない変種を探すのがこのリポジトリ。

## 先行事例(2026-08時点の調査)

- **AirLLMのブラウザ/WebGPU移植を名乗るものは見つからない**。このニッチは空いている
- [Llamas on the Web](https://arxiv.org/html/2605.20706v1)(llama.cpp WebGPUバックエンドの論文): OPFS→WebGPUへ小さなステージングバッファで重みを流す実装がある。ただし**ロード時**のメモリ効率化であり、VRAM超過モデルの毎トークンページングではない
- [Layer-wise inferencing + batching](https://verdagon.dev/blog/llm-throughput-not-ram-limited): レイヤーページングは**大バッチならスループットが出る**(レイヤー1回のロードを多数の系列で償却)。レイテンシは救えないがバッチ仕事なら成立する、という重要な観察
- [WebLLM](https://github.com/mlc-ai/web-llm) / wllama等の既存ブラウザ推論は「VRAMに載る前提」の世界。ここはその外側

## 研究ロードマップ

1. **E1: 帯域の実測** — FSA(File System Access)/OPFS→ArrayBuffer→`writeBuffer`の実効スループットをブラウザ実機で測る。全ての議論の分母
2. **E2: レイヤーページング骨格** — [web-xpu-ops](https://github.com/m96-chan/web-xpu-ops)のop群+常駐エンジンの上に、重みだけ非常駐(レイヤー単位でFSAからストリーム)の実行器を組む。まず3B級で「動く・正しい・遅い」を確立
3. **E3: バッチスループットモード** — 対話ではなくバッチ処理(データ生成、要約、記憶の整理)として回す。ユースケース例: キャラチャットの「睡眠時間」(深夜の無人時間帯)にブラウザ内ででかいモデルのバッチ仕事を回す
4. **E4: MoE expertページング(本命)** — denseの全量ストリームではなく、**スパースMoEのactive expertだけ**をストリームする。671B MoEが70B denseより流量が少ない世界。ホットexpertをVRAM常駐(LRU)、コールドをFSAからページング。これが成立すると「GPU poorがフロンティア級MoEをブラウザで回す」が視野に入る

## 関連

- [web-xpu-ops](https://github.com/m96-chan/web-xpu-ops) — WGSLオペ+実GPU検証ハーネス+llamaアーキ常駐エンジン(このリポの土台)
- 発想元: [AirLLM](https://github.com/lyogavin/airllm)
