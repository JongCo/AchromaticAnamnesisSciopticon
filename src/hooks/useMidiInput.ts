import { useCallback, useEffect, useRef, useState } from "react";
import type { MidiInputDevice, MidiNoteMessage } from "../types";

type UseMidiInputOptions = {
  selectedInputId: string | null;
  onMessage: (message: MidiNoteMessage) => void;
};

export function useMidiInput({ selectedInputId, onMessage }: UseMidiInputOptions) {
  const [supported, setSupported] = useState(() => "requestMIDIAccess" in navigator);
  const [devices, setDevices] = useState<MidiInputDevice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const accessRef = useRef<MIDIAccess | null>(null);
  const messageRef = useRef(onMessage);
  const devicesSignatureRef = useRef("");

  messageRef.current = onMessage;

  const refreshDevices = useCallback(() => {
    const access = accessRef.current;
    if (!access) return;
    const inputs = [...access.inputs.values()]
      .filter((input) => input.state !== "disconnected")
      .map((input) => ({
        id: input.id,
        name: input.name || "Unnamed MIDI input",
        manufacturer: input.manufacturer || undefined,
      }));
    const signature = inputs.map((input) => `${input.id}:${input.name}:${input.manufacturer ?? ""}`).join("|");
    if (signature === devicesSignatureRef.current) return;
    devicesSignatureRef.current = signature;
    setDevices(inputs);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const requestMIDIAccess = navigator.requestMIDIAccess?.bind(navigator);
    if (!requestMIDIAccess) {
      setSupported(false);
      return;
    }

    requestMIDIAccess()
      .then((access) => {
        if (cancelled) return;
        accessRef.current = access;
        access.addEventListener("statechange", refreshDevices);
        access.onstatechange = refreshDevices;
        refreshDevices();
      })
      .catch(() => {
        if (!cancelled) setError("Web MIDI 권한을 얻지 못했습니다. Chrome 또는 Edge에서 권한을 허용해 주세요.");
      });

    return () => {
      cancelled = true;
      if (accessRef.current) {
        accessRef.current.removeEventListener("statechange", refreshDevices);
        accessRef.current.onstatechange = null;
      }
    };
  }, [refreshDevices]);

  useEffect(() => {
    const intervalId = window.setInterval(refreshDevices, 1500);
    return () => window.clearInterval(intervalId);
  }, [refreshDevices]);

  useEffect(() => {
    const access = accessRef.current;
    if (!access) return;
    for (const input of access.inputs.values()) {
      input.onmidimessage = null;
    }
    const input = selectedInputId ? access.inputs.get(selectedInputId) : null;
    if (!input) return;

    input.onmidimessage = (event) => {
      if (!event.data) return;
      const [status, note, velocity = 0] = event.data;
      const command = status & 0xf0;
      if (command === 0x90 && velocity > 0) {
        messageRef.current({
          type: "noteon",
          midi: note,
          velocity: velocity / 127,
          receivedAtMs: performance.now(),
        });
      } else if (command === 0x80 || (command === 0x90 && velocity === 0)) {
        messageRef.current({
          type: "noteoff",
          midi: note,
          velocity: 0,
          receivedAtMs: performance.now(),
        });
      }
    };

    return () => {
      input.onmidimessage = null;
    };
  }, [selectedInputId, devices]);

  return { supported, devices, error };
}
