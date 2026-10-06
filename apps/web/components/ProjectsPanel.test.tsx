// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectsPanel } from "./ProjectsPanel";

afterEach(cleanup);

const projects = [{ key: "HND", name: "Kairo Demo", enabled: true, ticketCount: 10 }];
const buttons = () => screen.getAllByRole("button") as HTMLButtonElement[];

describe("ProjectsPanel", () => {
  it("is fully interactive in normal mode", () => {
    render(<ProjectsPanel connection={{ mode: "demo", baseUrl: "fixtures", readOnly: false }} initialProjects={projects} />);
    expect(buttons().every((b) => !b.disabled)).toBe(true);
    expect(document.body.textContent).not.toMatch(/read-only/i);
  });

  it("disables every action and says why in read-only mode", () => {
    render(<ProjectsPanel connection={{ mode: "demo", baseUrl: "fixtures", readOnly: true }} initialProjects={projects} />);
    expect(buttons().length).toBeGreaterThan(0);
    expect(buttons().every((b) => b.disabled)).toBe(true);
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
    expect(document.body.textContent).toMatch(/read-only demo/i);
  });

  it("treats a missing readOnly flag (older API) as normal mode", () => {
    render(<ProjectsPanel connection={{ mode: "demo", baseUrl: "fixtures" }} initialProjects={projects} />);
    expect(buttons().every((b) => !b.disabled)).toBe(true);
  });
});
