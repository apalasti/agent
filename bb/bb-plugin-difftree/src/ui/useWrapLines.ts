import { useCallback, useState } from "react";

const STORAGE_KEY = "difftree.wrapLines";

function load(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function useWrapLines(): [boolean, () => void] {
  const [wrap, setWrap] = useState(load);
  const toggle = useCallback(() => {
    setWrap((current) => {
      try {
        window.localStorage.setItem(STORAGE_KEY, current ? "0" : "1");
      } catch {
        // storage unavailable: the choice lasts for this session only
      }
      return !current;
    });
  }, []);
  return [wrap, toggle];
}
