import React from "react";

export const YandexIcon = ({ size = 16, className = "" }: { size?: number; className?: string }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 100 100" 
    fill="currentColor" 
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    {/* Modern stylized Yandex 'Y' in a circle, matching the user's provided screenshot */}
    <path 
      fillRule="evenodd" 
      clipRule="evenodd" 
      d="M50 100C22.386 100 0 77.614 0 50C0 22.386 22.386 0 50 0C77.614 0 100 22.386 100 50C100 77.614 77.614 100 50 100ZM50 88C29.013 88 12 70.987 12 50C12 29.013 29.013 12 50 12C70.987 12 88 29.013 88 50C88 70.987 70.987 88 50 88ZM56 72V50.5L74 25H62.5L50 43.5L37.5 25H26L44 50.5V72H56Z" 
    />
  </svg>
);
