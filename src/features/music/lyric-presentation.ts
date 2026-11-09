import type { LyricLine } from "../lyrics/model";

// Preserve timed lyrics; move only explicit credits/notices out of the score.
const credit =
  /^(?:作词|作曲|词曲|词|曲|编曲|编配|混音|混音师|录音|录音师|录音棚|母带|母带工程|制作人|制作|制作公司|统筹|企划|策划|营销|推广|宣发|监制|出品|出品公司|发行|发行公司|和声|吉他|贝斯|钢琴|鼓|弦乐|演唱|原唱|翻唱|配唱制作|封面|词作者|曲作者|lyrics?\s+by|compos(?:er|ed\s+by)|arrang(?:er|ed\s+by)|produced\s+by|mixed\s+by)\s*[:：]/i;
const notice =
  /未经.*(?:许可|授权)|不得.*(?:翻唱|翻录|使用)|版权所有|all rights reserved|copyright/i;

export function presentLyrics(lines: LyricLine[]) {
  const credits: string[] = [];
  const seen = new Set<string>();
  const score: { line: LyricLine; index: number }[] = [];
  lines.forEach((line, index) => {
    const text = line.text.trim();
    const clean = text
      .replace(/^[【\[（(]\s*/, "")
      .replace(/\s*[】\]）)]$/, "");
    if (credit.test(clean) || notice.test(clean)) {
      const key = clean.replace(/\s+/g, " ");
      if (!seen.has(key)) {
        credits.push(clean);
        seen.add(key);
      }
    } else if (text) score.push({ line, index });
  });
  return { score, credits };
}
