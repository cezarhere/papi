import { FUNCTION_HINTS } from "./formulaEdit";

interface FunctionSuggestionsProps {
  names: string[];
  activeIndex: number;
  position: { left: number; top: number };
  onPick: (name: string) => void;
}

// Function-name autocomplete shown under the input while typing a formula.
export default function FunctionSuggestions({ names, activeIndex, position, onPick }: FunctionSuggestionsProps) {
  return (
    <div className="suggestions" role="listbox" style={position}>
      {names.map((name, index) => (
        <div
          key={name}
          role="option"
          aria-selected={index === activeIndex}
          className={index === activeIndex ? "suggestion suggestion-active" : "suggestion"}
          // mousedown, not click: keeps focus (and the caret) in the input.
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(name);
          }}
        >
          <span className="suggestion-name">{name}</span>
          {FUNCTION_HINTS[name] !== undefined && <span className="suggestion-hint">({FUNCTION_HINTS[name]})</span>}
        </div>
      ))}
    </div>
  );
}
