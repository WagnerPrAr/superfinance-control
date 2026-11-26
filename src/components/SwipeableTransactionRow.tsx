import { useRef, useState, type ReactNode, type TouchEvent } from 'react';
import { Check, Pencil } from 'lucide-react';

interface SwipeableTransactionRowProps {
  isPaid: boolean;
  justPaid: boolean;
  onSwipeRightPay: () => void;
  onSwipeLeftEdit: () => void;
  children: ReactNode;
}

const SWIPE_THRESHOLD = 68;
const MAX_OFFSET = 92;

export function SwipeableTransactionRow({
  isPaid,
  justPaid,
  onSwipeRightPay,
  onSwipeLeftEdit,
  children,
}: SwipeableTransactionRowProps) {
  const startXRef = useRef<number | null>(null);
  const startYRef = useRef<number | null>(null);
  const [offsetX, setOffsetX] = useState(0);
  const [dragging, setDragging] = useState(false);

  function handleTouchStart(e: TouchEvent<HTMLDivElement>) {
    const touch = e.touches[0];
    if (!touch) return;
    startXRef.current = touch.clientX;
    startYRef.current = touch.clientY;
    setDragging(true);
  }

  function handleTouchMove(e: TouchEvent<HTMLDivElement>) {
    if (startXRef.current === null || startYRef.current === null) return;
    const touch = e.touches[0];
    if (!touch) return;
    const dx = touch.clientX - startXRef.current;
    const dy = touch.clientY - startYRef.current;
    // Ignora se for scroll vertical predominante
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(offsetX) < 10) return;
    const clamped = Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, dx));
    setOffsetX(clamped);
  }

  function handleTouchEnd() {
    if (offsetX >= SWIPE_THRESHOLD) {
      onSwipeRightPay();
    } else if (offsetX <= -SWIPE_THRESHOLD) {
      onSwipeLeftEdit();
    }
    startXRef.current = null;
    startYRef.current = null;
    setDragging(false);
    setOffsetX(0);
  }

  return (
    <div className={`swipe-row-shell ${justPaid ? 'paid-row-flash' : ''}`}>
      {offsetX !== 0 && (
        <div
          className={`swipe-hint ${offsetX > 0 ? 'swipe-hint-right' : 'swipe-hint-left'}`}
          aria-hidden="true"
        >
          {offsetX > 0 ? (
            <>
              <Check size={16} />
              <span>{isPaid ? 'Marcar Pendente' : 'Marcar Pago'}</span>
            </>
          ) : (
            <>
              <span>Editar</span>
              <Pencil size={15} />
            </>
          )}
        </div>
      )}

      <div
        className="list-row swipe-row-content"
        style={{
          transform: `translateX(${offsetX}px)`,
          transition: dragging ? 'none' : 'transform 0.32s cubic-bezier(0.34, 1.45, 0.64, 1)',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {children}
      </div>
    </div>
  );
}
