import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, CanvasRenderer]);

export const PALETTE = ['#0f766e', '#c97422', '#4338ca', '#0369a1', '#a16207', '#be123c', '#4d7c0f', '#7c3aed', '#0e7490', '#9a3412', '#475569'];

const BASE = {
  color: PALETTE,
  textStyle: { fontFamily: 'Vazirmatn, system-ui, sans-serif', color: '#2c3f55' },
  animationDuration: 600,
  tooltip: {
    backgroundColor: 'rgba(20, 32, 46, 0.96)',
    borderWidth: 0,
    padding: [8, 12],
    textStyle: { color: '#f4f1ea', fontSize: 12, fontFamily: 'Vazirmatn, system-ui' },
    extraCssText: 'direction: rtl; text-align: right; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.25);'
  }
};

// Thin ECharts wrapper: resizes with its container and re-renders when `option` changes.
// On narrow (phone) containers legends scroll instead of wrapping over the plot.
export function Chart({ option, height = 320, onClick, className }) {
  const ref = useRef(null);
  const chart = useRef(null);
  const clickRef = useRef(onClick);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => { clickRef.current = onClick; }, [onClick]);

  useEffect(() => {
    chart.current = echarts.init(ref.current, null, { renderer: 'canvas' });
    chart.current.on('click', (params) => clickRef.current?.(params));
    const observer = new ResizeObserver(() => {
      chart.current?.resize();
      setNarrow((ref.current?.clientWidth || 1000) < 560);
    });
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      chart.current?.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    if (!chart.current || !option) return;
    const legend = option.legend && narrow ? { ...option.legend, type: 'scroll', left: 0, right: 0 } : option.legend;
    chart.current.setOption({
      ...BASE, ...option, ...(legend ? { legend } : {}),
      tooltip: option.tooltip === false ? { show: false } : { ...BASE.tooltip, ...option.tooltip, confine: true }
    }, true);
  }, [option, narrow]);

  return <div ref={ref} className={className} style={{ height, width: '100%' }} />;
}

// Common axis styling.
export const axisStyle = {
  axisLine: { lineStyle: { color: '#d6cfbf' } },
  axisTick: { show: false },
  axisLabel: { color: '#5b6b7e', fontSize: 11 },
  splitLine: { lineStyle: { color: '#eee9df' } }
};
