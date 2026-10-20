import { useEffect, useState } from 'react';

// Whether a media query matches, kept up to date.
export function useMedia(query) {
  const [match, setMatch] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

export const MOBILE = '(max-width: 860px)';
export const TOUCH = '(pointer: coarse)';
