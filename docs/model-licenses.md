# Downloaded model licenses

Dataset Annotation Studio does not include model weights in this repository. The model
download center fetches only adapter-owned plans pinned to a specific Hugging Face
revision, validates declared file sizes and SHA-256 hashes, and installs the result into
the user's local model library.

Each model remains governed by its own license. The project's Apache-2.0 license does
not replace or extend to downloaded weights.

| Model | Built-in plan license label | Source |
| --- | --- | --- |
| CL Tagger v2.01a | `LicenseRef-CL-Tagger-v2` (custom terms) | [cella110n/cl_tagger_v2](https://huggingface.co/cella110n/cl_tagger_v2) |
| WD Tagger v3 · SwinV2 | `Apache-2.0` | [SmilingWolf/wd-swinv2-tagger-v3](https://huggingface.co/SmilingWolf/wd-swinv2-tagger-v3) |
| PixAI Tagger v0.9 · ONNX | `Apache-2.0` | [deepghs/pixai-tagger-v0.9-onnx](https://huggingface.co/deepghs/pixai-tagger-v0.9-onnx) |
| JoyTag · ONNX | `Apache-2.0` | [fancyfeast/joytag](https://huggingface.co/fancyfeast/joytag) |
| AnimeTimm DBv4 · CaFormer B36 | `GPL-3.0` | [animetimm/caformer_b36.dbv4-full](https://huggingface.co/animetimm/caformer_b36.dbv4-full) |
| Camie Tagger v2 | `GPL-3.0` | [Camais03/camie-tagger-v2](https://huggingface.co/Camais03/camie-tagger-v2) |

The label is a convenience snapshot for the pinned plan, not legal advice. Users must
open the linked terms and confirm them before starting a download. Repository owners
may change model cards later; built-in plans therefore also expose the exact pinned
revision used for file verification.

Do not copy these weights into Dataset Annotation Studio releases without separately
reviewing the applicable model license and redistribution conditions.
