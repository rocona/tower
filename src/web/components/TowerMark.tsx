interface TowerMarkProps {
  className?: string;
}

export function TowerMark({ className = 'h-8 w-8' }: TowerMarkProps) {
  return (
    <svg
      viewBox="0 0 120 120"
      className={className}
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M28 31H92V45H66V94H54V45H28V31Z" fill="currentColor" />
      <circle cx="60" cy="17" r="7" className="fill-[#EA580C] dark:fill-[#F97316]" />
    </svg>
  );
}
