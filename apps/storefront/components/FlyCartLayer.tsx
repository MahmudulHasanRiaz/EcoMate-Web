"use client";

import React, { useEffect, useState } from 'react';

interface FlyingItem {
  id: number;
  x: number;
  y: number;
  image: string;
}

export default function FlyCartLayer() {
  const [items, setItems] = useState<FlyingItem[]>([]);

  useEffect(() => {
    const handleFly = ((e: CustomEvent) => {
      setItems(prev => [
        ...prev, 
        { id: Date.now() + Math.random(), x: e.detail.x, y: e.detail.y, image: e.detail.image }
      ]);
    }) as EventListener;
    
    window.addEventListener('fly-to-cart', handleFly);
    return () => window.removeEventListener('fly-to-cart', handleFly);
  }, []);

  const removeItem = (id: number) => {
    setItems(prev => prev.filter(item => item.id !== id));
  };

  return (
    <div className="fixed inset-0 pointer-events-none z-[999999]" style={{ overflow: 'hidden' }}>
      {items.map(item => (
        <FlyingDot key={item.id} item={item} onComplete={() => removeItem(item.id)} />
      ))}
    </div>
  );
}

function FlyingDot({ item, onComplete }: { item: FlyingItem, onComplete: () => void; key?: string | number }) {
  const [isActive, setIsActive] = useState(false);
  const [targetPos, setTargetPos] = useState({ x: item.x, y: item.y });

  useEffect(() => {
    // eslint-disable-next-line prefer-const
    let target = document.getElementById('floating-cart');

    let targetX = window.innerWidth - 30;
    let targetY = window.innerHeight / 2;

    if (target && !target.className.includes('translate-x-[120%]')) {
      const rect = target.getBoundingClientRect();
      targetX = rect.left + rect.width / 2;
      targetY = rect.top + rect.height / 2;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTargetPos({ x: targetX, y: targetY });

    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setIsActive(true);
      });
    });

    const timer = setTimeout(() => {
        target?.classList.add('scale-[1.15]', '-translate-x-2', 'brightness-110');
        setTimeout(() => {
          target?.classList.remove('scale-[1.15]', '-translate-x-2', 'brightness-110');
        }, 300);
        onComplete();
    }, 850);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [item, onComplete]);

  return (
    <div 
      className="fixed pointer-events-none"
      style={{
        left: item.x,
        top: item.y,
        transform: isActive ? `translate(${targetPos.x - item.x}px, 0)` : 'translate(0px, 0px)',
        transition: 'transform 0.85s cubic-bezier(0.2, 0.8, 0.2, 1)',
        zIndex: 999999
      }}
    >
      <div
        className="w-24 h-24 md:w-32 md:h-32 bg-white rounded-full p-2 border-[4px] border-brand-blue flex items-center justify-center shadow-[0_15px_45px_-5px_rgba(0,137,205,0.6)] overflow-hidden"
        style={{
          transform: isActive
            ? `translate(-50%, calc(${targetPos.y - item.y}px - 50%)) scale(0.1) rotate(720deg)`
            : 'translate(-50%, -50%) scale(1) rotate(-45deg)',
          transition: 'transform 0.85s cubic-bezier(0.5, -0.6, 0.5, 1.3), opacity 0.85s ease-in',
          opacity: isActive ? 0.3 : 1,
        }}
      >
        <img src={item.image || undefined} alt="Flying Item" className="w-full h-full object-contain drop-shadow-md" />
      </div>
    </div>
  );
}
