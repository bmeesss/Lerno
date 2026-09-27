import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

function classes(variant: Variant, size: Size, block?: boolean, extra?: string): string {
  return [
    'btn',
    `btn-${variant}`,
    size !== 'md' ? `btn-${size}` : '',
    block ? 'btn-block' : '',
    extra ?? '',
  ]
    .filter(Boolean)
    .join(' ');
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  block,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button className={classes(variant, size, block, className)} {...rest}>
      {children}
    </button>
  );
}

export interface ButtonLinkProps extends LinkProps {
  variant?: Variant;
  size?: Size;
  block?: boolean;
}

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  block,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link className={classes(variant, size, block, className)} {...rest}>
      {children}
    </Link>
  );
}
