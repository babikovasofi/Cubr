// Кубок контуром вместо эмодзи 🏆: эмодзи тянуло свой цвет и рендерилось
// по-разному в системах. Тут — линия `currentColor` без заливки, значит иконка
// берёт цвет текста и одинаково живёт в светлой и тёмной теме.

export default function TrophyIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className={className}
    >
      <path d="M7 3.5h10V8a5 5 0 0 1-10 0V3.5Z" />
      <path d="M7 5.2H5.1A2.4 2.4 0 0 0 5.1 10H6.2" />
      <path d="M17 5.2h1.9A2.4 2.4 0 0 1 18.9 10H17.8" />
      <path d="M12 13v3" />
      <path d="M9.6 20.5c.8-1 1.2-2.2 1.2-4.5h2.4c0 2.3.4 3.5 1.2 4.5" />
      <path d="M8.2 20.5h7.6" />
    </svg>
  );
}
