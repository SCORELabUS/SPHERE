import React from 'react';

const BanterLoader: React.FC = () => {
  return (
    <div className="-ml-9 -mt-9 grid h-18 w-18 grid-cols-3 gap-1.5">
      {Array.from({ length: 9 }).map((_, index) => {
        return (
          <div
            key={index}
            className="banter-box h-[20px] w-[20px] animate-banter-box bg-tp-primary"
          />
        );
      })}
    </div>
  );
};

export default BanterLoader;