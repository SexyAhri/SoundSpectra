export function PerformanceGuide() {
  return (
    <details className="performance-guide">
      <summary>时间编排怎么用？</summary>
      <ol>
        <li>
          <strong>安排画面</strong>
          <span>
            新建演出，在左侧展开「添加时间标记」，填写歌曲秒数并新增。在右侧选择这一刻要出现的灯效。
          </span>
        </li>
        <li>
          <strong>检查节奏</strong>
          <span>
            点选左侧标记会跳到对应画面；点「播放预演」或拖动播放头检查整段。这里使用模拟音频。
          </span>
        </li>
        <li>
          <strong>跟随歌曲</strong>
          <span>
            在播放器播放目标歌曲，点预演区的「绑定当前曲目」，再点右下角「开启演出模式」。桌面灯效按歌曲进度执行。
          </span>
        </li>
      </ol>
      <p>
        例如：0 秒「潮汐之结」→ 15 秒「层海」→ 30
        秒「星尘航道」。标记会自动保存；暂停时保持当前画面，拖动歌曲进度会直接切到对应段落。
      </p>
    </details>
  );
}
