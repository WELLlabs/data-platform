import React, { createContext, useContext, useState, useCallback, useRef } from "react";
import Ic from "./Icons";

const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [msg, setMsg] = useState("");
  const [show, setShow] = useState(false);
  const timer = useRef(null);

  const toast = useCallback((m) => {
    setMsg(m);
    setShow(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShow(false), 2200);
  }, []);

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className={"toast" + (show ? " show" : "")} role="status" aria-live="polite">
        <Ic name="check" size={16} sw={2.4} />
        {msg}
      </div>
    </ToastCtx.Provider>
  );
}
