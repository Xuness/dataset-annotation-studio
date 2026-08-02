# Dial Archive fonts

The theme bundles four font families under the SIL Open Font License 1.1. The complete
copyright notices and license are in `OFL-1.1.txt`; the footer exposes that file in the built
application as well as in source distributions.

| Local file                       | Upstream family | Local treatment                                              |
| -------------------------------- | --------------- | ------------------------------------------------------------ |
| `Saira-100900.woff2`             | Saira           | Latin variable font used by display typography               |
| `Archivo-100900.woff2`           | Archivo         | Latin variable fallback for display typography               |
| `JetBrainsMono-400800.woff2`     | JetBrains Mono  | Latin variable font used by telemetry and microcopy          |
| `NotoSansSC-subset-100900.woff2` | Noto Sans SC    | Variable font subset containing this theme's shipped UI text |

The Noto Sans SC subset was produced from Google Fonts' official
`ofl/notosanssc/NotoSansSC[wght].ttf`. It retains the `wght` axis and OFL metadata. When visible
copy changes, regenerate the subset from the official source and verify every CJK code point in
`spaceRegistry.ts` and this theme's TSX files before committing it.

SHA-256 checksums:

```text
Archivo-100900.woff2        E3A28EADE21A900C7155A247757F4B2834C07BB7EF07AD7EFA55CEBAAC1E8F5E
JetBrainsMono-400800.woff2  83C005D49D8A6A50474C73A5A36AC0468076E9C4A29DA7BDB14995D80560A5BE
NotoSansSC-subset-100900.woff2  6C45CE20F8506AA4C5AECD4AA696576851A3A428E1DA0643A9C740AF43EA0293
Saira-100900.woff2          D5F1EE1CE85A2F6611D76BCD98738132F4706B099DC167F02C2093A1EC5EB975
```
