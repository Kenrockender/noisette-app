import Image from "next/image";

/**
 * A photo slot.
 *
 * Given a `photo` (a static import from lib/photos.js) it renders next/image:
 * automatic width and height, a blur placeholder, and WebP/AVIF served to
 * browsers that take them. Given no photo it falls back to the kraft stripe and
 * a serif monogram, which is honest about the picture not existing yet.
 *
 * On alt text: pass `alt` only where the photo carries meaning on its own. In
 * the catalog and the bag the product name sits right next to the image, so the
 * default empty alt is correct and stops screen readers saying it twice.
 */
export default function PhotoFrame({
  photo,
  alt = "",
  label = "",
  className = "",
  sizes = "100vw",
  priority = false,
  children,
}) {
  if (photo) {
    return (
      <div className={`frame ${className}`}>
        <Image
          src={photo}
          alt={alt}
          fill
          sizes={sizes}
          placeholder="blur"
          priority={priority}
          className="frame-img"
        />
      </div>
    );
  }

  const monogram = label.trim().charAt(0).toUpperCase();
  return (
    <div className={`frame ${className}`} aria-hidden="true">
      {children ?? (monogram && <span className="frame-monogram">{monogram}</span>)}
    </div>
  );
}
