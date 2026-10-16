# SerenaPost source provenance

Upstream: https://github.com/SerenaMugua/serena-post/tree/1.1.5
Tag: `1.1.5`; commit: `5b4cb53d0545154ef0b61c1d257e444c3891acf8`.
Imported on 2026-10-17. Only the listed source/license files were copied. Author portraits, brand icons, compiled bundles and the browser-cookie X client are excluded.

## TALOS adaptations

- `src/utils/formatter.ts`: escape generated image/link attributes.
- `src/services/weixin-api.ts`: encode query values, preserve API error codes, omit raw credential-bearing diagnostics.
- `vendor/kaitox/relay/config.ts`, `server.ts`, `storage.ts`: explicit private root; in-memory pairing token; no shared home, environment mutation or process takeover.
- `vendor/kaitox/relay/videoFit.ts`: preserve supported media; no automatic external converter execution.
- `vendor/kaitox/relay-protocol/relayClient.ts`: abort signals and preallocated delivery ID.

All other upstream logic remains under its original MIT terms. TALOS wrappers are under the repository license; third-party permissions remain intact.

## Original file fingerprints

| Upstream path | SHA-256 before local adaptations |
|---|---|
| `LICENSE` | `f9ce3bcafec8ff636bb810a1fda29e4890f4425b817ed262f848bac04683c7fe` |
| `THIRD_PARTY_NOTICES.md` | `b1e8996ad73785ea4b67037ab859f191b4514b86163ce8afd9dbe89a22f242dd` |
| `src/services/weixin-api.ts` | `41c78a6308f0c0f70722106400a86ee40b51ef4201aca5abbe4fd150e37b5875` |
| `src/theme-editor/custom-theme.ts` | `589b2538466480997da1d84660a4fadeb1ea093b20348f008c0540e52e08d9be` |
| `src/types/index.ts` | `933f35f910b02c912e2a19aa1c90ca66135c1a8fb146379daf78d49f7bdcbeae` |
| `src/utils/css-to-inline.ts` | `4c972a06c345a0cd27273bcbb7139e8d55271a0259f9564d49390952f4a5ef7f` |
| `src/utils/formatter.ts` | `aec015ead2623a046cc5d9c65d644089b419677ef79973328b7930a831780ff3` |
| `src/utils/heading-styles.ts` | `ae27434c4c99a27ed8a84a03cc3235d3261576f2694d7c6ac7d33e480b4863e1` |
| `src/utils/image.ts` | `f3712ec70d2e478c4f2ee26838af8a75ce45e69205b386a82ba286da76bdf797` |
| `src/utils/media.ts` | `e9d5407da94174ba7ca42865c767e355ff68838106889035977e0ecb26ac0785` |
| `vendor/kaitox/LICENSE` | `16138695c9afea75df0072cfcdaaa748867a20537187a93a533ae81d801a9d5a` |
| `vendor/kaitox/relay-protocol/base64.ts` | `38418107437cd068316c8b7a38388890dc2dad971cfc3d3490de83346f912627` |
| `vendor/kaitox/relay-protocol/bundle.ts` | `d19557c3ddd842371d2a1ef2f1f7d645700fad25f116623f7f3155e8990b64ee` |
| `vendor/kaitox/relay-protocol/index.ts` | `d9b6946e07bfdc987682ba80d89c74a80d23e6ef30438483af5c774dee7e83a6` |
| `vendor/kaitox/relay-protocol/relayClient.ts` | `11e7906541ddbc45d88c43b69821c3b8cd67a20ad97c6f8fd8205aa12ef7919c` |
| `vendor/kaitox/relay-protocol/validate.ts` | `f41b0e90025633428b19430afd0e40608b8f9597299b618592c0b1d2c2380e14` |
| `vendor/kaitox/relay/config.ts` | `91d377e815272ef0f767c32f9cac9f6b0dae4298bebc43a450a6a9d0d1b2065d` |
| `vendor/kaitox/relay/imageFit.ts` | `eca6d6fee9fbb0b798e04ce7d04b7943e2c3c6dec0cb70aa98b9ee268b7962dc` |
| `vendor/kaitox/relay/server.ts` | `12276a9ebbed4feec08abdd56099a0dbeb100229aaae1897c9b72bb9e43c69ae` |
| `vendor/kaitox/relay/storage.ts` | `df997a74148c8b5e561ea12c81dafa7af60a1505ca3c366f54bd8a65d2555da3` |
| `vendor/kaitox/relay/videoFit.ts` | `22610f712ad19a435fdb9919acbf00dd88c06fd814f6d8f3b2bc29aeef2d9c4b` |
| `vendor/kaitox/x-article-preview.css` | `99d9e470707917f70bd4ba1031c0173dfae221924bf574d6477f2e6c7c09dbef` |
| `vendor/kaitox/x-article/contentState.ts` | `96b653a30ce4833af37685aaff0dc22e8a728f2168f12e3f856f49c665547650` |
| `vendor/kaitox/x-article/media.ts` | `14e2b3cfed627ef5a3d0ecc842552f356a71d15276ac6865626e069c4a3dd66f` |
| `vendor/kaitox/x-article/previewHtml.ts` | `88382110ca87548f5a1f5edc14b57495118773aca41febe5ce427efa8b75f40d` |
| `vendor/kaitox/x-article/previewModel.ts` | `eeacba6b52fdfb5fbaca77c98c409d69321219b041c19805e4842aaa33154855` |
| `vendor/kaitox/x-article/pushHelpers.ts` | `f90a041ac97fba35a07b6dac3c6d6ff83d31c710b992f38e55fa00fc8ce01cbe` |
| `vendor/kaitox/x-article/styleCheck.ts` | `39de7673d8ef15ca9daa9ca797b86c5b063c2969035d647ed6d129f82ba97545` |
| `vendor/kaitox/x-article/types.ts` | `2bac4a4d189ef91ca0b22c25c9cd2100d7c8da66b165c7eb9933ae1b6464641b` |
