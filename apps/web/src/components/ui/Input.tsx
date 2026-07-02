import React from 'react';
import { cn } from '../../lib/utils';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, icon, className, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label className="text-sm font-medium text-app-text">
            {label}
            {props.required && <span className="text-danger mr-1">*</span>}
          </label>
        )}
        <div className="relative">
          {icon && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-app-muted">
              {icon}
            </span>
          )}
          <input
            ref={ref}
            {...props}
            className={cn(
              'w-full border border-app-border rounded-lg px-3 py-2 text-sm text-app-text bg-white',
              'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors',
              'disabled:bg-gray-50 disabled:text-app-muted',
              'placeholder:text-gray-400',
              icon ? 'pr-9' : '',
              error ? 'border-danger focus:ring-danger/30 focus:border-danger' : '',
              className
            )}
          />
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  children: React.ReactNode;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, children, className, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label className="text-sm font-medium text-app-text">
            {label}
            {props.required && <span className="text-danger mr-1">*</span>}
          </label>
        )}
        <select
          ref={ref}
          {...props}
          className={cn(
            'w-full border border-app-border rounded-lg px-3 py-2 text-sm text-app-text bg-white',
            'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors',
            'disabled:bg-gray-50 disabled:text-app-muted',
            error ? 'border-danger focus:ring-danger/30 focus:border-danger' : '',
            className
          )}
        >
          {children}
        </select>
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    );
  }
);

Select.displayName = 'Select';
