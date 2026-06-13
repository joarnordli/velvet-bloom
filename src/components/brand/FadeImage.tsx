import { useState, type ImgHTMLAttributes } from "react";

/**
 * <img> that fades in once it loads. Eliminates the "pop" when a photo
 * lands on a dark plate.
 */
export function FadeImage({
  className = "",
  onLoad,
  ...rest
}: ImgHTMLAttributes<HTMLImageElement>) {
  const [loaded, setLoaded] = useState(false);
  return (
    <img
      {...rest}
      onLoad={(e) => {
        setLoaded(true);
        onLoad?.(e);
      }}
      className={`${className} transition-opacity duration-300 ease-out ${loaded ? "opacity-100" : "opacity-0"}`}
    />
  );
}
