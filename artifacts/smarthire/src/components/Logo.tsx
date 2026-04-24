export function Logo({ variant = 'dark', size = 32 }: {
  variant?: 'dark' | 'light',
  size?: number
}) {
  const textColor1 = '#CE3D3A'
  const textColor2 = '#555555'
  const triangleRed = '#CE3D3A'
  const triangleGray = '#555555'

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
      onClick={() => window.location.href = '/'}>
      <svg width={size} height={size} viewBox="0 0 132 130" fill="none">
        {/* left red blade */}
        <path
          d="M2 92 L69 0 L67 46 C66 62, 61 75, 54 89 L37 124 Z"
          fill={triangleRed}
        />
        {/* top silver blade */}
        <path
          d="M69 0 L132 102 L94 94 C82 91, 74 82, 70 67 L67 46 Z"
          fill={triangleGray}
        />
        {/* lower sweep */}
        <path
          d="M37 124 L54 89 C61 75, 66 62, 67 46 L70 67 C74 82, 82 91, 94 94 L132 102 L67 112 C54 114, 45 117, 37 124 Z"
          fill={triangleGray}
          opacity="0.7"
        />
      </svg>
      <span style={{
        fontSize: size * 0.55,
        fontWeight: 700,
        letterSpacing: '-0.5px',
        lineHeight: 1
      }}>
        <span style={{ color: textColor1 }}>Accion</span>
        <span style={{ color: textColor2 }}>Hire</span>
      </span>
    </div>
  )
}
