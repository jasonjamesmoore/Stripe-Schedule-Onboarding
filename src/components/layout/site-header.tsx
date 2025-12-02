import Image from "next/image";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 w-full inset-x-0 mb-6 md:mb-8 border-b bg-[#254B58]">
      <div className="container mx-auto max-w-7xl h-44 md:h-40 px-4 flex justify-center items-center text-[#FCCF86]">
        <Image
          src="/tidal-cans-01.webp"
          alt="Tidal Cans"
          width={1500}
          height={844}
          className="h-40 md:h-36 w-auto select-none"
          draggable={false}
        />
      </div>
    </header>
  );
}
