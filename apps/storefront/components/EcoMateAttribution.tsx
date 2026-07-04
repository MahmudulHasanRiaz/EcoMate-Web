interface Props {
  storeName: string
}

export default function EcoMateAttribution({ storeName }: Props) {
  return (
    <div className="flex flex-col items-center pb-[104px] md:pb-6 px-4 max-w-[360px] mx-auto">
      <p className="text-[12px] font-normal text-gray-500 text-center leading-relaxed">
        &copy; {new Date().getFullYear()} {storeName}. All rights reserved.
      </p>

      <a
        href="https://ecomate.business"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center no-underline text-gray-400 hover:opacity-70 transition-opacity mt-[6px]"
      >
        <img
          src="/icons/ecomate.svg"
          alt=""
          className="h-[14px] w-auto"
        />
        <span className="text-[11px] font-medium leading-[1] text-gray-400 ml-[6px]">
          on EcoMate
        </span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="ml-[4px] opacity-60"
        >
          <path d="M2 8L8 2M8 2H3.5M8 2V6.5" />
        </svg>
      </a>
    </div>
  )
}
