import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { Buffer } from "node:buffer";

test("starts on the MIDI selection screen and can enter free play", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "AchromaticAnamnesisSciopticon" })).toBeVisible();
  await expect(page.getByText("MIDI를 고르고 연주 방식을 선택하세요.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Library/ }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Game" })).toHaveClass(/active/);
  await expect(page.getByRole("button", { name: "선택한 MIDI로 시작" })).toBeDisabled();

  await page.getByRole("button", { name: "Practice" }).click();
  await expect(page.getByRole("button", { name: "Practice" })).toHaveClass(/active/);
  await expect(page.getByRole("button", { name: "Game" })).not.toHaveClass(/active/);

  await page.getByRole("button", { name: "자유 연주" }).click();

  await expect(page.getByRole("heading", { name: "내장 SoundFont 준비 중" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "내장 SoundFont 준비 중" })).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator(".mode-pill")).toHaveText("Free Play");
  await expect(page.getByRole("button", { name: "뒤로가기" })).toBeVisible();
  await expect(page.getByText("MIDI 없이 연주 중")).toBeVisible();
  await expect(page.getByRole("button", { name: "Game" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Practice" })).toHaveCount(0);
  await expect(page.getByTitle("Play")).toHaveCount(0);
  await expect(page.getByText("Reverb", { exact: true })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Mix" })).toHaveValue("0.2");
  await expect(page.getByRole("slider", { name: "Decay" })).toHaveValue("2.4");
  await expect(page.getByRole("slider", { name: "Damp" })).toHaveValue("6000");
  await expect(page.getByLabel("MIDI 장치")).toBeHidden();
  await page.getByText("MIDI 입력", { exact: true }).click();
  await expect(page.getByLabel("MIDI 장치")).toBeVisible();
  await expect(page.getByLabel("Key Min")).toBeVisible();
  await expect(page.locator("summary", { hasText: "건반 범위" })).toHaveCount(0);
  await page.getByText("오디오", { exact: true }).click();
  await expect(page.getByRole("slider", { name: "Mix" })).toBeHidden();
  await page.getByText("오디오", { exact: true }).click();

  await page.getByRole("slider", { name: "Mix" }).fill("0.35");
  await page.getByRole("slider", { name: "Decay" }).fill("3.1");
  await page.getByRole("slider", { name: "Damp" }).fill("4800");
  await expect.poll(() => page.evaluate(() => {
    const raw = localStorage.getItem("achromatic-anamnesis-sciopticon-settings");
    return raw ? JSON.parse(raw).reverb : null;
  })).toEqual({ mix: 0.35, decay: 3.1, damp: 4800 });
});

test("uploads a MIDI file before entering the selected practice mode", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Practice" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "tiny-scale.mid",
    mimeType: "audio/midi",
    buffer: Buffer.from(makeTinyMidiFile()),
  });

  await expect(page.locator(".selection-file-meta strong")).toHaveText("tiny-scale.mid");
  await expect(page.getByText("1 tracks, 1 notes")).toBeVisible();
  await expect(page.getByRole("button", { name: "선택한 MIDI로 시작" })).toBeEnabled();
  await page.getByRole("button", { name: "tiny-scale.mid 이름 수정" }).click();
  await page.getByRole("textbox", { name: "tiny-scale.mid 표시 이름" }).fill("작은 음계 연습");
  await page.getByRole("button", { name: "이름 저장" }).click();
  await page.getByRole("button", { name: "난이도 7/20으로 설정" }).click();

  await page.getByRole("button", { name: "선택한 MIDI로 시작" }).click();

  await expect(page.locator(".mode-pill")).toHaveText("practice");
  await expect(page.locator(".stage-header h1")).toHaveText("작은 음계 연습");
  await expect(page.locator(".stage-header p")).toHaveText("난이도 7/20");
  await expect(page.getByRole("button", { name: "뒤로가기" })).toBeVisible();
  await expect(page.getByText("tiny-scale.mid")).toBeVisible();
  await expect(page.getByRole("button", { name: "Game" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Practice" })).toHaveCount(0);
  await expect(page.getByTitle("Play")).toBeVisible();
});

test("copies dropped MIDI files into app folders and reopens them later", async ({ page }) => {
  await page.goto("/");

  await page.getByPlaceholder("새 폴더").fill("Etudes");
  await page.getByTitle("폴더 만들기").click();
  await page.getByRole("button", { name: /Etudes/ }).click();

  await dropMidiFile(page, "dragged-etude.mid");

  await expect(page.locator(".library-file", { hasText: "dragged-etude.mid" })).toHaveClass(/entering/);
  await expect(page.locator(".selection-file-meta strong")).toHaveText("dragged-etude.mid");
  await expect(page.getByText("1 tracks, 1 notes")).toBeVisible();
  await expect(page.getByRole("button", { name: "선택한 MIDI로 시작" })).toBeEnabled();
  await page.getByRole("button", { name: "dragged-etude.mid 이름 수정" }).click();
  await page.getByRole("textbox", { name: "dragged-etude.mid 표시 이름" }).fill("드래그 에튀드");
  await page.getByRole("button", { name: "이름 저장" }).click();
  await expect(page.locator(".library-file-select", { hasText: "드래그 에튀드" })).toBeVisible();
  await page.getByRole("button", { name: "난이도 14/20으로 설정" }).click();
  await expect(page.getByRole("button", { name: "난이도 14/20으로 설정" })).toHaveAttribute("aria-pressed", "true");

  await page.reload();

  await page.getByRole("button", { name: /Etudes/ }).click();
  await expect(page.locator(".library-file-select", { hasText: "드래그 에튀드" })).toBeVisible();
  await expect(page.getByRole("button", { name: "난이도 14/20으로 설정" })).toHaveAttribute("aria-pressed", "true");
  await page.locator(".library-file-select", { hasText: "드래그 에튀드" }).click();
  await expect(page.locator(".selection-file-meta strong")).toHaveText("dragged-etude.mid");
  await expect(page.getByText("1 tracks, 1 notes")).toBeVisible();
  await expect(page.getByRole("button", { name: "선택한 MIDI로 시작" })).toBeEnabled();

  await page.locator(".library-file", { hasText: "드래그 에튀드" }).dragTo(page.getByRole("button", { name: /Library/ }).first());
  await expect(page.locator(".library-file-select", { hasText: "드래그 에튀드" })).toHaveCount(0);
  await page.getByRole("button", { name: /Library/ }).first().click();
  await expect(page.locator(".library-file-select", { hasText: "드래그 에튀드" })).toBeVisible();
  await expect(page.getByRole("button", { name: "난이도 14/20으로 설정" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "드래그 에튀드 이름 수정" }).click();
  await page.getByRole("textbox", { name: "dragged-etude.mid 표시 이름" }).fill("");
  await page.getByRole("button", { name: "이름 저장" }).click();
  await expect(page.locator(".library-file-select", { hasText: "dragged-etude.mid" })).toBeVisible();

  await page.reload();
  await expect(page.locator(".library-file-select", { hasText: "dragged-etude.mid" })).toBeVisible();

  const deleteButton = page.getByRole("button", { name: "dragged-etude.mid 삭제" });
  await deleteButton.click();
  await expect(page.getByRole("button", { name: "dragged-etude.mid 삭제 확인" })).toHaveAttribute("aria-pressed", "true");
  await page.getByText("MIDI를 고르고 연주 방식을 선택하세요.").click();
  await expect(page.getByRole("button", { name: "dragged-etude.mid 삭제" })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "dragged-etude.mid 삭제" }).click();
  await expect(page.getByRole("button", { name: "dragged-etude.mid 삭제 확인" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "dragged-etude.mid 삭제 확인" }).click();
  await expect(page.locator(".library-file", { hasText: "dragged-etude.mid" })).toHaveClass(/deleting/);
  await expect(page.locator(".library-file-select", { hasText: "dragged-etude.mid" })).toHaveCount(0);

  await page.reload();
  await expect(page.locator(".library-file-select", { hasText: "dragged-etude.mid" })).toHaveCount(0);
});

async function dropMidiFile(page: Page, name: string): Promise<void> {
  const bytes = Array.from(makeTinyMidiFile());
  const dataTransfer = await page.evaluateHandle(
    ({ bytes: fileBytes, name: fileName }) => {
      const dataTransfer = new DataTransfer();
      const file = new File([new Uint8Array(fileBytes)], fileName, { type: "audio/midi" });
      dataTransfer.items.add(file);
      return dataTransfer;
    },
    { bytes, name },
  );

  await page.dispatchEvent(".selection-shell", "drop", { dataTransfer });
}

function makeTinyMidiFile(): Uint8Array {
  const header = [
    0x4d, 0x54, 0x68, 0x64,
    0x00, 0x00, 0x00, 0x06,
    0x00, 0x00,
    0x00, 0x01,
    0x01, 0xe0,
  ];
  const trackEvents = [
    0x00, 0xff, 0x03, 0x0a, ...ascii("Tiny Track"),
    0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20,
    0x00, 0x90, 0x3c, 0x60,
    0x83, 0x60, 0x80, 0x3c, 0x40,
    0x00, 0xff, 0x2f, 0x00,
  ];
  const track = [
    0x4d, 0x54, 0x72, 0x6b,
    ...uint32(trackEvents.length),
    ...trackEvents,
  ];

  return new Uint8Array([...header, ...track]);
}

function ascii(value: string): number[] {
  return [...value].map((char) => char.charCodeAt(0));
}

function uint32(value: number): number[] {
  return [
    (value >> 24) & 0xff,
    (value >> 16) & 0xff,
    (value >> 8) & 0xff,
    value & 0xff,
  ];
}
