import { describe, expect, it } from 'vitest';
import { renderDiary } from './markdown';

describe('renderDiary', () => {
  it('renders the diary structure', () => {
    const html = renderDiary(
      '# 第 1 天 · 2026-11-11\n\n## 今天做了什麼\n走到廣場。\n看了方塊。\n\n- 一\n- 二',
    );
    expect(html).toContain('<h2>第 1 天 · 2026-11-11</h2>');
    expect(html).toContain('<h3>今天做了什麼</h3>');
    expect(html).toContain('<p>走到廣場。<br>看了方塊。</p>');
    expect(html).toContain('<ul><li>一</li><li>二</li></ul>');
  });

  it('escapes HTML from model output', () => {
    const html = renderDiary('## <img src=x onerror=alert(1)>\n<script>bad()</script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
