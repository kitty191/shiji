const paths = {
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m16 16 4 4" />
    </>
  ),
  cart: (
    <>
      <path d="M3 3h2l3 12h10l3-9H6M9 19h.01M18 19h.01" />
      <circle cx="9" cy="20" r="1" />
      <circle cx="18" cy="20" r="1" />
    </>
  ),
  message: <path d="M21 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 19 0Z" />,
  help: (
    <>
      <path d="M4 13V10a8 8 0 0 1 16 0v3M20 17v2a2 2 0 0 1-2 2h-4" />
      <rect x="2" y="10" width="4" height="8" rx="2" />
      <rect x="18" y="10" width="4" height="8" rx="2" />
    </>
  ),
  up: (
    <>
      <path d="m6 12 6-6 6 6M12 6v14M4 3h16" />
    </>
  ),
  chevron: <path d="m6 9 6 6 6-6" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
};
export function Icon({ name }: { name: keyof typeof paths }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
