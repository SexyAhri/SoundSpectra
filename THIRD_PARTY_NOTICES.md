# Third-party notices

Package licenses are distributed with their dependencies; versions are locked in the npm and Cargo lockfiles.

SoundSpectra itself is Copyright (C) 2026 SexyAhri, licensed under GPL-3.0-only (see LICENSE and COPYRIGHT). Third-party licenses are independent of the project notice. The licenses directory accompanies this file in packaged builds.

Frontend runtime license texts from the installed, locked npm packages are collected in `licenses/frontend.txt`. Tauri's MIT notice is in `licenses/tauri-MIT.txt`; its alternative Apache-2.0 terms and the Apache-2.0 terms for `lyrics-crypto` are in `licenses/Apache-2.0.txt`. These files do not change any dependency's license choice.

The GitHub mark in `src/assets/github-mark.svg` is from GitHub's Primer Octicons (`icons/mark-github-16.svg`), Copyright (c) 2026 GitHub Inc., MIT. The complete notice is in `licenses/github-octicons-MIT.txt`.

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
