/** Minimal inline icon set (stroke style, currentColor). */

type IconProps = { size?: number; className?: string };

function icon(paths: React.ReactNode, viewBox = '0 0 24 24') {
  return function Icon({ size = 20, className }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox={viewBox}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
      >
        {paths}
      </svg>
    );
  };
}

export const IconHome = icon(
  <>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h14V9.5" />
    <path d="M9 21v-6h6v6" />
  </>,
);

export const IconBook = icon(
  <>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </>,
);

export const IconLayers = icon(
  <>
    <path d="m12 2 9 5-9 5-9-5 9-5z" />
    <path d="m3 12 9 5 9-5" />
    <path d="m3 17 9 5 9-5" />
  </>,
);

export const IconCompass = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="m15.5 8.5-2 5-5 2 2-5 5-2z" />
  </>,
);

export const IconChart = icon(
  <>
    <path d="M3 3v18h18" />
    <path d="M7 15v3" />
    <path d="M12 10v8" />
    <path d="M17 6v12" />
  </>,
);

export const IconHeart = icon(
  <path d="M20.8 5.6a5.5 5.5 0 0 0-7.8 0L12 6.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 22l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" />,
);

export const IconGear = icon(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.98 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.98a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09c0 .68.4 1.29 1.03 1.56a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.02c.27.62.88 1.03 1.56 1.03H21a2 2 0 1 1 0 4h-.09c-.68 0-1.29.4-1.56 1.03z" />
  </>,
);

export const IconUser = icon(
  <>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />
  </>,
);

export const IconShield = icon(
  <>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </>,
);

export const IconPlus = icon(
  <>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </>,
);

export const IconSearch = icon(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </>,
);

export const IconX = icon(
  <>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </>,
);

export const IconArrowRight = icon(
  <>
    <path d="M5 12h14" />
    <path d="m13 6 6 6-6 6" />
  </>,
);

export const IconCheck = icon(<path d="M4 12.5 9.5 18 20 7" />);

export const IconStar = icon(
  <path d="m12 2 3 6.5 7 .9-5 4.9 1.2 7L12 18l-6.2 3.3L7 14.3l-5-4.9 7-.9L12 2z" />,
);

export const IconSun = icon(
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </>,
);

export const IconMoon = icon(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />);

export const IconLogout = icon(
  <>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5" />
    <path d="M21 12H9" />
  </>,
);

export const IconEdit = icon(
  <>
    <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
  </>,
);

export const IconTrash = icon(
  <>
    <path d="M3 6h18" />
    <path d="M8 6V4h8v2" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M10 11v6M14 11v6" />
  </>,
);

export const IconFlag = icon(
  <>
    <path d="M4 22V4" />
    <path d="M4 4h13l-2 4 2 4H4" />
  </>,
);

export const IconClock = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </>,
);

export const IconFlame = icon(
  <path d="M12 22c4.4 0 7-2.9 7-6.7 0-2.6-1.5-4.6-3-6.3-.5 1.3-1.3 2.2-2.2 2.7.3-2.8-.8-6.3-3.8-9.7.1 3-1.3 5.2-2.7 7C6 10.5 5 12.4 5 15.3 5 19.1 7.6 22 12 22z" />,
);

export const IconCards = icon(
  <>
    <rect x="3" y="6" width="14" height="14" rx="2" />
    <path d="M7 3h12a2 2 0 0 1 2 2v11" />
    <path d="M7 11h6M7 15h4" />
  </>,
);

export const IconQuiz = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.2 9a2.8 2.8 0 0 1 5.5.9c0 1.8-2.7 2.3-2.7 4" />
    <path d="M12 17.5h.01" />
  </>,
);

export const IconZap = icon(<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />);

export const IconSparkles = icon(
  <>
    <path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z" />
    <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" />
  </>,
);

export const IconSend = icon(
  <>
    <path d="M22 2 11 13" />
    <path d="M22 2 15 22l-4-9-9-4 20-7z" />
  </>,
);

export const IconCopy = icon(
  <>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </>,
);

export const IconRefresh = icon(
  <>
    <path d="M21 12a9 9 0 1 1-3.2-6.9" />
    <path d="M21 4v5h-5" />
  </>,
);

export const IconLightbulb = icon(
  <>
    <path d="M9 18h6" />
    <path d="M10 21h4" />
    <path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5.9 1.1 1 1.8l.1.8h4.8l.1-.8c.1-.7.4-1.3 1-1.8A6 6 0 0 0 12 3z" />
  </>,
);

export const IconAlert = icon(
  <>
    <path d="M12 4 2.5 20h19L12 4z" />
    <path d="M12 10v4" />
    <path d="M12 17.5h.01" />
  </>,
);

export const IconUpload = icon(
  <>
    <path d="M12 16V4" />
    <path d="m7 9 5-5 5 5" />
    <path d="M4 20h16" />
  </>,
);

export const IconFile = icon(
  <>
    <path d="M7 3h7l5 5v13H7z" />
    <path d="M14 3v5h5" />
  </>,
);

export const IconImage = icon(
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m5 18 4.5-5 4 4.5 2.5-2.5L20 18" />
  </>,
);

export const IconAudio = icon(
  <>
    <path d="M4 10v4" />
    <path d="M8 7v10" />
    <path d="M12 4v16" />
    <path d="M16 8v8" />
    <path d="M20 11v2" />
  </>,
);

export const IconVideo = icon(
  <>
    <rect x="3" y="5" width="18" height="14" rx="3" />
    <path d="m11 9.5 4 2.5-4 2.5z" />
  </>,
);
