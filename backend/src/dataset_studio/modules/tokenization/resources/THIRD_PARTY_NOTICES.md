# Built-in tokenizer notices

The tokenizer data in this directory is committed so token counting works
offline and remains reproducible. It is data only; model weights are not
included.

## Qwen3-0.6B

- Source: <https://huggingface.co/Qwen/Qwen3-0.6B>
- Revision: `c1899de289a04d12100db370d81485cdf75e47ca`
- Source file: `tokenizer.json`
- License: Apache-2.0

## Qwen3-VL-4B-Instruct

- Source: <https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct>
- Revision: `ebb281ec70b05090aa6165b016eac8ec08e71b17`
- Source file: `tokenizer.json`
- License: Apache-2.0

## T5 v1.1 XXL

- Vocabulary source: <https://huggingface.co/google/t5-v1_1-xxl>
- Revision: `3db67ab1af984cf10548a73467f0e5bca2aaaeb2`
- Source file: `spiece.model`
- License: Apache-2.0
- Fast-tokenizer compatibility reference:
  [ComfyUI T5 tokenizer at `1305fb2`](https://github.com/Comfy-Org/ComfyUI/blob/1305fb294ca69d0a44d88c5bf7ce8c682abd0c8a/comfy/text_encoders/t5_tokenizer/tokenizer.json)

The 32,000 SentencePiece entries and scores in the committed Fast Tokenizer
were verified byte-for-byte/numerically against the pinned T5 `spiece.model`.
Its Fast Tokenizer preprocessing is retained to match the T5 path used by
Anima-compatible ComfyUI pipelines.

All three upstream tokenizer/model repositories declare Apache-2.0. The full
Apache-2.0 license text is available in the repository root `LICENSE` file.
