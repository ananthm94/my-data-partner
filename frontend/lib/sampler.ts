import Papa from "papaparse";

const MAX_BYTES = 100 * 1024 * 1024; // 100 MB

export function needsSampling(file: File): boolean {
  return file.size > MAX_BYTES;
}

export async function sampleFile(
  file: File,
  onProgress?: (msg: string) => void
): Promise<Blob> {
  if (!needsSampling(file)) return file;

  onProgress?.("Optimizing large dataset for rapid analysis...");

  const fileSizeMB = file.size / (1024 * 1024);
  const p = 90 / fileSizeMB;

  return new Promise((resolve, reject) => {
    const rows: string[][] = [];
    let header: string[] | null = null;

    Papa.parse(file, {
      worker: true,
      step(result) {
        const row = result.data as string[];
        if (!header) {
          header = row;
          rows.push(row);
          return;
        }
        if (Math.random() < p) {
          rows.push(row);
        }
      },
      complete() {
        const csv = Papa.unparse(rows);
        resolve(new Blob([csv], { type: "text/csv" }));
      },
      error(err) {
        reject(err);
      },
    });
  });
}
