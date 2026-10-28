# Third-party notices

The design of this project was informed by the source-level comparison in
`docs/three-way-analysis.md` and by the following upstream projects. No
project is bundled as a runtime dependency; the notes below preserve
attribution for the ideas and for any pattern-level reuse.

## MichengAI/dsh-btw — Apache-2.0

- Upstream: https://github.com/MichengAI/dsh-btw
- Used for: fork-based side-question engine, execution-time answer-only tool
  guard, prompt-cache prefix discipline, job lifecycle and cleanup shape.
- Copyright belongs to the upstream authors. Apache-2.0 terms apply to any
  derived portion.

## kaieye/dsh-AIR — MIT

- Upstream: https://github.com/kaieye/dsh-AIR
- Used for: reference points on streaming through a retained child session,
  cancellation/quiescence, and parent in-flight context capture.

## WLV-ZEDD/dsh-btw — MIT

- Upstream: https://github.com/WLV-ZEDD/dsh-btw
- Used for: reference points on the floating side-panel product surface and
  visible status badges.

## can1357/oh-my-pi — MIT

- Upstream: https://github.com/can1357/oh-my-pi
- Used for: the `/btw` semantic contract — same model/system/tools prefix,
  read-only execution, ephemeral side channel, topic/status/follow-up model.

## MIT license text

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
