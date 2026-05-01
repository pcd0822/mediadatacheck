/**
 * 팩트체크 친구 — 학생용 친근 마스코트.
 *
 * - <Mascot />: 단독 캐릭터 (인사·아이콘용)
 * - <MascotScene />: 캐릭터 + 미디어 아이콘 + 배경. 로그인/대시보드 히어로 영역용.
 */

export default function Mascot({ size = 160, className = "", waving = true }) {
  return (
    <svg
      viewBox="0 0 200 220"
      width={size}
      height={size * (220 / 200)}
      className={className}
      role="img"
      aria-label="팩트체크 친구"
    >
      <defs>
        <linearGradient id="mascotBody" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#7BAAFF" />
          <stop offset="100%" stopColor="#3A6FD8" />
        </linearGradient>
        <radialGradient id="mascotCheek">
          <stop offset="0%" stopColor="#FF9AA2" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#FF9AA2" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="mascotLens" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#D4ECFF" />
          <stop offset="100%" stopColor="#A8D8FF" />
        </linearGradient>
      </defs>

      {/* 그림자 */}
      <ellipse cx="100" cy="200" rx="60" ry="7" fill="#0F2A66" opacity="0.12" />

      {/* 몸 */}
      <circle cx="100" cy="105" r="68" fill="url(#mascotBody)" />

      {/* 광택 */}
      <ellipse cx="78" cy="78" rx="22" ry="14" fill="#FFFFFF" opacity="0.28" />

      {/* 눈 */}
      <circle cx="80" cy="100" r="14" fill="#FFFFFF" />
      <circle cx="120" cy="100" r="14" fill="#FFFFFF" />
      <circle cx="83" cy="103" r="6.5" fill="#1A1A2E" />
      <circle cx="123" cy="103" r="6.5" fill="#1A1A2E" />
      <circle cx="86" cy="100" r="2.2" fill="#FFFFFF" />
      <circle cx="126" cy="100" r="2.2" fill="#FFFFFF" />

      {/* 볼터치 */}
      <circle cx="68" cy="123" r="11" fill="url(#mascotCheek)" />
      <circle cx="132" cy="123" r="11" fill="url(#mascotCheek)" />

      {/* 미소 */}
      <path
        d="M 86 128 Q 100 142 114 128"
        stroke="#1A1A2E"
        strokeWidth="3.5"
        strokeLinecap="round"
        fill="none"
      />

      {/* 인사하는 손 (왼쪽) */}
      {waving && (
        <g>
          <circle cx="40" cy="78" r="13" fill="url(#mascotBody)" />
          <circle cx="40" cy="78" r="9" fill="#FFD7A8" />
        </g>
      )}

      {/* 돋보기 (오른쪽 아래) */}
      <g>
        <line
          x1="155"
          y1="160"
          x2="184"
          y2="190"
          stroke="#8C6A45"
          strokeWidth="7"
          strokeLinecap="round"
        />
        <circle cx="148" cy="152" r="24" fill="url(#mascotLens)" stroke="#8C6A45" strokeWidth="6" />
        <ellipse cx="140" cy="144" rx="7" ry="4.5" fill="#FFFFFF" opacity="0.75" />
      </g>
    </svg>
  );
}

export function MascotScene({ className = "" }) {
  return (
    <svg
      viewBox="0 0 480 280"
      className={className}
      role="img"
      aria-label="미디어를 살펴보는 팩트체크 친구"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id="sceneBg" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#E6F0FF" />
          <stop offset="100%" stopColor="#FFFFFF" />
        </linearGradient>
        <linearGradient id="sceneBody" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#7BAAFF" />
          <stop offset="100%" stopColor="#3A6FD8" />
        </linearGradient>
        <radialGradient id="sceneCheek">
          <stop offset="0%" stopColor="#FF9AA2" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#FF9AA2" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="sceneLens" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#D4ECFF" />
          <stop offset="100%" stopColor="#A8D8FF" />
        </linearGradient>
      </defs>

      {/* 배경 */}
      <rect width="480" height="280" fill="url(#sceneBg)" />

      {/* 떠다니는 점들 */}
      <circle cx="60" cy="60" r="4" fill="#FFD7A8" opacity="0.6" />
      <circle cx="420" cy="50" r="5" fill="#A6E6BC" opacity="0.6" />
      <circle cx="430" cy="200" r="3" fill="#FFB4A2" opacity="0.6" />
      <circle cx="50" cy="220" r="4" fill="#A8D8FF" opacity="0.7" />
      <circle cx="380" cy="120" r="3" fill="#FFD7A8" opacity="0.7" />

      {/* 왼쪽: 신문 */}
      <g transform="translate(40, 130) rotate(-8)">
        <rect width="80" height="100" rx="6" fill="#FFFFFF" stroke="#C8D4E6" strokeWidth="2" />
        <rect x="10" y="12" width="60" height="6" rx="2" fill="#3A6FD8" />
        <rect x="10" y="26" width="40" height="4" rx="2" fill="#C8D4E6" />
        <rect x="10" y="36" width="55" height="4" rx="2" fill="#C8D4E6" />
        <rect x="10" y="46" width="45" height="4" rx="2" fill="#C8D4E6" />
        <rect x="10" y="62" width="60" height="28" rx="3" fill="#E6F0FF" />
      </g>

      {/* 오른쪽: 휴대폰 */}
      <g transform="translate(380, 130) rotate(10)">
        <rect width="56" height="100" rx="10" fill="#FFFFFF" stroke="#C8D4E6" strokeWidth="2" />
        <rect x="6" y="14" width="44" height="60" rx="4" fill="#E6F0FF" />
        <circle cx="28" cy="86" r="4" fill="#C8D4E6" />
        <rect x="14" y="26" width="28" height="4" rx="2" fill="#7BAAFF" />
        <rect x="14" y="36" width="20" height="3" rx="1.5" fill="#C8D4E6" />
        <rect x="14" y="44" width="24" height="3" rx="1.5" fill="#C8D4E6" />
      </g>

      {/* 가운데: 캐릭터 */}
      <g transform="translate(180, 30)">
        <ellipse cx="60" cy="200" rx="56" ry="7" fill="#0F2A66" opacity="0.12" />
        <circle cx="60" cy="105" r="68" fill="url(#sceneBody)" />
        <ellipse cx="38" cy="78" rx="22" ry="14" fill="#FFFFFF" opacity="0.28" />

        <circle cx="40" cy="100" r="14" fill="#FFFFFF" />
        <circle cx="80" cy="100" r="14" fill="#FFFFFF" />
        <circle cx="43" cy="103" r="6.5" fill="#1A1A2E" />
        <circle cx="83" cy="103" r="6.5" fill="#1A1A2E" />
        <circle cx="46" cy="100" r="2.2" fill="#FFFFFF" />
        <circle cx="86" cy="100" r="2.2" fill="#FFFFFF" />

        <circle cx="28" cy="123" r="11" fill="url(#sceneCheek)" />
        <circle cx="92" cy="123" r="11" fill="url(#sceneCheek)" />

        <path
          d="M 46 128 Q 60 142 74 128"
          stroke="#1A1A2E"
          strokeWidth="3.5"
          strokeLinecap="round"
          fill="none"
        />

        {/* 인사하는 손 */}
        <circle cx="-2" cy="78" r="13" fill="url(#sceneBody)" />
        <circle cx="-2" cy="78" r="9" fill="#FFD7A8" />

        {/* 돋보기 */}
        <line
          x1="115"
          y1="160"
          x2="148"
          y2="190"
          stroke="#8C6A45"
          strokeWidth="7"
          strokeLinecap="round"
        />
        <circle cx="108" cy="152" r="24" fill="url(#sceneLens)" stroke="#8C6A45" strokeWidth="6" />
        <ellipse cx="100" cy="144" rx="7" ry="4.5" fill="#FFFFFF" opacity="0.75" />
      </g>

      {/* 작은 체크마크들 */}
      <g transform="translate(150, 80)">
        <circle r="11" fill="#A6E6BC" />
        <path
          d="M -4 0 L -1 4 L 5 -3"
          stroke="#1B6B3A"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </g>
      <g transform="translate(340, 90)">
        <circle r="11" fill="#FFD7A8" />
        <path
          d="M -3 -3 L 3 3 M 3 -3 L -3 3"
          stroke="#8C5A1F"
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
        />
      </g>
    </svg>
  );
}
