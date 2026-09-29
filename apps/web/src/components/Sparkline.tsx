interface Props {
  values: number[];
  label: string;
  width?: number;
  height?: number;
}

/** Tiny distance-over-turns chart (lower is better, 0 = solved). */
export function Sparkline({ values, label, width = 240, height = 44 }: Props) {
  if (values.length === 0) return null;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const y = (v: number) => 4 + (height - 8) * (v / max);
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = values.at(-1)!;
  return (
    <figure className="spark">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label={`${label}: ${values.join(", ")}`}
      >
        <line x1="0" x2={width} y1={y(0)} y2={y(0)} className="spark-zero" />
        <polyline points={points} className="spark-line" />
        <circle cx={(values.length - 1) * step} cy={y(last)} r="3" className="spark-dot" />
      </svg>
      <figcaption>
        distance {values[0]} → {last}
      </figcaption>
    </figure>
  );
}
