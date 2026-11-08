# Third-party notices

Package licenses are distributed with their dependencies; versions are locked in the npm and Cargo lockfiles.

SoundSpectra itself is Copyright (C) 2026 SexyAhri, licensed under GPL-3.0-only (see LICENSE and COPYRIGHT). Third-party licenses are independent of the project notice. The licenses directory accompanies this file in packaged builds.

Frontend runtime license texts from the installed, locked npm packages are collected in `licenses/frontend.txt`. Tauri's MIT notice is in `licenses/tauri-MIT.txt`; its alternative Apache-2.0 terms and the Apache-2.0 terms for `lyrics-crypto` are in `licenses/Apache-2.0.txt`. These files do not change any dependency's license choice.

The folded-curtain lyric renderer and its isolated experiment use Anime.js 4.5.0 (MIT), Copyright (c) 2025 Julian Garnier. Its complete notice is in `licenses/animejs-MIT.txt`.

The GitHub mark in `src/assets/github-mark.svg` is from GitHub's Primer Octicons (`icons/mark-github-16.svg`), Copyright (c) 2026 GitHub Inc., MIT. The complete notice is in `licenses/github-octicons-MIT.txt`.

Windows clipboard image import uses `arboard` 3.7.0 (MIT OR Apache-2.0), Copyright (c) 2022 The Arboard contributors. Its MIT notice is in `licenses/arboard-MIT.txt`.

TTML parsing uses `roxmltree` 0.20.0 (MIT OR Apache-2.0), Copyright (c) 2018 Yevhenii Reizner. Its MIT notice is in `licenses/roxmltree-MIT.txt`.

Read-only NetEase client song metadata access uses `rusqlite` 0.40.2 (MIT), Copyright (c) 2014 The rusqlite developers. Its complete notice is in `licenses/rusqlite-MIT.txt`. The bundled SQLite library is public domain.

The byte transformation for read-only NetEase playback event decoding in `src-tauri/src/now_playing/netease.rs` is adapted from Coooookies/netease-cloudmusic-detector, commit `f86eb7c83914ffcc045ca2279655fda2b87b279c` (MIT), Copyright (c) 2025 ButterCookies. Its complete notice is in `licenses/netease-cloudmusic-detector-MIT.txt`. Playback event validation, incremental reading and clock reconstruction are implemented in SoundSpectra.

Read-only Soda client lyric cache decoding uses `rmpv` 1.3.1 (MIT), Copyright (c) 2017 Evgeny Safronov. Its complete notice is in `licenses/rmpv-MIT.txt`. The format 2 page reader and bounded record decoding are implemented in SoundSpectra; no client JavaScript, native library, credentials, or lyrics are bundled.

For songs identified by the installed NetEase client's local metadata database, missing lyrics may be retrieved at runtime from NetEase's public lyric endpoint. This sends the verified song ID without client cookies or login credentials. Responses are cached in SoundSpectra's own data directory; the player's database and cache files are not modified. No NetEase lyrics are bundled.

Online lyrics are retrieved at runtime from the AMLL TTML public HTTP API (https://api.amll.dev; documentation: https://amll.dev/reference/http-api/overview). Song IDs, original TTML and contributor usernames are retained in the local cache. No third-party song lyrics are bundled. Availability in a public lyric database does not transfer ownership of the lyrics or grant SoundSpectra rights to the underlying recordings.

QQ local lyric decoding uses `lyrics-crypto` 0.5.1 (Apache-2.0), from ChouChiu/Lyrics-Helper. The QMC1 envelope key and transformation in `src-tauri/src/lyrics.rs` are adapted from Jixun Wu's `qmc-decode`, https://github.com/jixunmoe/qmc-decode (MIT):

Copyright (c) 2019 Jixun Wu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

The previously bundled two-dimensional fluid solver has been removed from the source tree. Its MIT notice remains available in historical revisions containing that solver.

Noto Sans SC Variable and Noto Serif SC Variable (5.3.1), distributed through Fontsource, are bundled locally for lyric typography. Copyright belongs to the Noto Project Authors. Licensed under SIL Open Font License 1.1; full notices are in `licenses/noto-sans-sc-OFL.txt` and `licenses/noto-serif-sc-OFL.txt`. Font files are unmodified.
