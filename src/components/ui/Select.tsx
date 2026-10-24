import { Check, ChevronDown } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  icon?: ReactNode;
  color?: string;
}

interface SelectProps {
  value: string;
  options: SelectOption[];
  onValueChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  size?: "compact" | "default";
  variant?: "plain" | "field";
  leadingIcon?: ReactNode;
  disabled?: boolean;
  className?: string;
}

interface MenuPosition {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
}

const VIEWPORT_MARGIN = 8;
const MENU_GAP = 6;
const MAX_MENU_HEIGHT = 280;

export function Select({
  value,
  options,
  onValueChange,
  ariaLabel,
  placeholder = "请选择",
  size = "default",
  variant = "field",
  leadingIcon,
  disabled = false,
  className = "",
}: SelectProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState<MenuPosition>();
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) setPosition(undefined);
  }
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const firstEnabledIndex = useCallback(() => options.findIndex((option) => !option.disabled), [options]);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const availableBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN - MENU_GAP;
    const availableAbove = rect.top - VIEWPORT_MARGIN - MENU_GAP;
    const openBelow = availableBelow >= Math.min(160, MAX_MENU_HEIGHT) || availableBelow >= availableAbove;
    const availableHeight = openBelow ? availableBelow : availableAbove;
    const maxHeight = Math.max(96, Math.min(MAX_MENU_HEIGHT, availableHeight));
    const minimumWidth = variant === "plain" ? 210 : rect.width;
    const width = Math.min(Math.max(rect.width, minimumWidth), window.innerWidth - VIEWPORT_MARGIN * 2);
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, rect.left),
      Math.max(VIEWPORT_MARGIN, window.innerWidth - VIEWPORT_MARGIN - width),
    );

    setPosition({
      top: openBelow ? rect.bottom + MENU_GAP : undefined,
      bottom: openBelow ? undefined : window.innerHeight - rect.top + MENU_GAP,
      left,
      width,
      maxHeight,
    });
  }, [variant]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  const [activeSyncKey, setActiveSyncKey] = useState({ open, selectedIndex, firstEnabledIndex, options });
  if (
    activeSyncKey.open !== open ||
    activeSyncKey.selectedIndex !== selectedIndex ||
    activeSyncKey.firstEnabledIndex !== firstEnabledIndex ||
    activeSyncKey.options !== options
  ) {
    setActiveSyncKey({ open, selectedIndex, firstEnabledIndex, options });
    if (open)
      setActiveIndex(selectedIndex >= 0 && !options[selectedIndex]?.disabled ? selectedIndex : firstEnabledIndex());
  }

  const moveActive = (direction: 1 | -1) => {
    if (!options.length) return;
    let next = activeIndex;
    for (let attempt = 0; attempt < options.length; attempt += 1) {
      next = (next + direction + options.length) % options.length;
      if (!options[next]?.disabled) {
        setActiveIndex(next);
        return;
      }
    }
  };

  const choose = (option: SelectOption) => {
    if (option.disabled) return;
    if (option.value !== value) onValueChange(option.value);
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const openMenu = () => {
    if (disabled) return;
    setActiveIndex(selectedIndex >= 0 && !options[selectedIndex]?.disabled ? selectedIndex : firstEnabledIndex());
    setOpen(true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (disabled) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      if (!open) {
        openMenu();
      } else {
        moveActive(event.key === "ArrowDown" ? 1 : -1);
      }
      return;
    }
    if (open && (event.key === "Home" || event.key === "End")) {
      event.preventDefault();
      event.stopPropagation();
      const ordered = event.key === "Home" ? options : [...options].reverse();
      const option = ordered.find((item) => !item.disabled);
      if (option) setActiveIndex(options.indexOf(option));
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      if (!open) openMenu();
      else if (activeIndex >= 0 && options[activeIndex]) choose(options[activeIndex]);
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (event.key === "Tab") setOpen(false);
  };

  const menu =
    open && position
      ? createPortal(
          <div
            ref={menuRef}
            id={listboxId}
            className="ui-select-menu"
            role="listbox"
            aria-label={ariaLabel}
            style={position}
            onKeyDown={onKeyDown}
          >
            {options.map((option, index) => (
              <button
                type="button"
                id={`${listboxId}-option-${index}`}
                role="option"
                aria-selected={option.value === value}
                disabled={option.disabled}
                tabIndex={-1}
                key={option.value}
                className={`ui-select-option ${index === activeIndex ? "is-active" : ""} ${option.value === value ? "is-selected" : ""}`}
                onMouseEnter={() => {
                  if (!option.disabled) setActiveIndex(index);
                }}
                onClick={() => choose(option)}
              >
                {option.icon && <span className="ui-select-option-icon">{option.icon}</span>}
                {option.color && <i className="ui-select-color" style={{ backgroundColor: option.color }} />}
                <span className="ui-select-option-copy">
                  <strong>{option.label}</strong>
                  {option.description && <small>{option.description}</small>}
                </span>
                {option.value === value && <Check className="ui-select-check" size={15} />}
              </button>
            ))}
          </div>,
          document.body,
        )
      : null;

  return (
    <div className={`ui-select ui-select-${variant} ui-select-${size} ${open ? "is-open" : ""} ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        className="ui-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
        disabled={disabled}
        onClick={() => {
          if (open) setOpen(false);
          else openMenu();
        }}
        onKeyDown={onKeyDown}
      >
        {leadingIcon && <span className="ui-select-leading">{leadingIcon}</span>}
        {selected?.color && <i className="ui-select-color" style={{ backgroundColor: selected.color }} />}
        <span className={`ui-select-value ${selected ? "" : "is-placeholder"}`}>
          <strong>{selected?.label ?? placeholder}</strong>
        </span>
        <ChevronDown className="ui-select-chevron" size={14} />
      </button>
      {menu}
    </div>
  );
}
