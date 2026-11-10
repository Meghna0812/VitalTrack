// Small inline SVG icons. Inline SVG needs no icon library or extra network request,
// and `currentColor` lets each icon take the colour of its category.
const PATHS = {
  drop: 'M12 2.5c-3.6 4.7-6.5 8.1-6.5 11.6a6.5 6.5 0 0 0 13 0c0-3.5-2.9-6.9-6.5-11.6z',
  heart: 'M12 20.5s-7.6-4.6-9.5-9.3C1.1 7.8 3.2 4 7 4c2.1 0 3.6 1.2 5 3 1.4-1.8 2.9-3 5-3 3.8 0 5.9 3.8 4.5 7.2-1.9 4.7-9.5 9.3-9.5 9.3z',
  cube: 'M12 2.5l8.2 4.7v9.6L12 21.5l-8.2-4.7V7.2z',
  bean: 'M15.5 3C19 3 21 6 21 10c0 5.5-4 11-8.5 11-3 0-4-2-4-3.6 0-1.6 1.2-2.4 1.2-3.9S8 11 8 9c0-3.5 3.5-6 7.5-6z',
  leaf: 'M20 4C10 4 4 9 4 16c0 1.4.3 2.6.8 3.6C6 13 10 10 15 8c-4 3-7 6.5-8.6 11.2.9.5 2 .8 3.1.8C16 20 20 14 20 4z',
  spark: 'M12 2l2.6 7.4L22 12l-7.4 2.6L12 22l-2.6-7.4L2 12l7.4-2.6z',
  bolt: 'M13.5 2L4 13.5h6.5L9.5 22 20 9.5h-6.5z',
  sun: 'M12 6.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11zM11 1h2v3h-2zM11 20h2v3h-2zM1 11h3v2H1zM20 11h3v2h-3z',
  user: 'M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zm0 2c-4.4 0-8 2.2-8 5v2h16v-2c0-2.8-3.6-5-8-5z',
  upload: 'M12 3l5 5h-3.5v6h-3V8H7zM4 16h2v3h12v-3h2v5H4z',
  trash: 'M9 3h6l1 2h4v2H4V5h4zM6 9h12l-1 12H7z',
  doc: 'M6 2h8l5 5v15H6zm7 1.5V8h4.5zM8.5 12v1.8h8V12zm0 4v1.8h8V16z',
  chart: 'M3 20h18v2H3zM5 11h3v7H5zm5.5-5h3v12h-3zM16 13h3v5h-3z',
  calendar: 'M7 2h2v2h6V2h2v2h3v18H4V4h3zm-1 8v10h12V10z',
  pencil: 'M15.2 4.2l4.6 4.6L9 19.6H4.4V15zM17 2.4l1.4-1.4 4.6 4.6L21.6 7z',
};

export default function Icon({ name, size = 20, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d={PATHS[name]} />
    </svg>
  );
}
