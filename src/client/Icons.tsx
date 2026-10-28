import React from 'react'

interface IconProps {
  readonly size?: number
  readonly className?: string
}

function Svg({ size = 16, className, children }: IconProps & { readonly children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

export function MarginaliaIcon({ size = 16, className }: IconProps): React.JSX.Element {
  return (
    <Svg size={size} className={className}>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H14l6 6v8.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13Z" />
      <path d="M14 4v6h6" />
      <path d="M8 15h5" />
      <path d="M19.5 2.5l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6.6-1.6Z" />
    </Svg>
  )
}

export function CopyIcon(props: IconProps): React.JSX.Element {
  return <Svg {...props}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></Svg>
}

export function CheckIcon(props: IconProps): React.JSX.Element {
  return <Svg {...props}><path d="m5 12 4 4L19 6" /></Svg>
}

export function CloseIcon(props: IconProps): React.JSX.Element {
  return <Svg {...props}><path d="M6 6l12 12M18 6 6 18" /></Svg>
}

export function StopIcon(props: IconProps): React.JSX.Element {
  return <Svg {...props}><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" /></Svg>
}

export function ChevronIcon({ up = false, ...props }: IconProps & { readonly up?: boolean }): React.JSX.Element {
  return <Svg {...props}><path d={up ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} /></Svg>
}

export function HistoryIcon(props: IconProps): React.JSX.Element {
  return <Svg {...props}><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /><path d="M12 7v5l3 2" /></Svg>
}

export function TrashIcon(props: IconProps): React.JSX.Element {
  return <Svg {...props}><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="M6 7l1 13h10l1-13" /><path d="M10 11v5M14 11v5" /></Svg>
}

export function RefreshIcon(props: IconProps): React.JSX.Element {
  return <Svg {...props}><path d="M20 7v5h-5" /><path d="M4 17v-5h5" /><path d="M5.5 9a7 7 0 0 1 11.7-2.6L20 9" /><path d="M18.5 15a7 7 0 0 1-11.7 2.6L4 15" /></Svg>
}

export function SendIcon(props: IconProps): React.JSX.Element {
  return <Svg {...props}><path d="M4 12 20 4l-8 16-2-6-6-2Z" /></Svg>
}

export function PlusIcon(props: IconProps): React.JSX.Element {
  return <Svg {...props}><path d="M12 5v14M5 12h14" /></Svg>
}
