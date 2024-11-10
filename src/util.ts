
type DiffOperation = "Add" | "Delete" | "NoOp"

export async function applyPatchToFile(stagedFile: string, patch: string, reverse: boolean): Promise<string> {
    const oldfileLines = stagedFile.split("\n");

    const patchLines = patch.split("\n");
    const patchOffsetArr = patchLines.splice(0, 1)[0].match(/^@@ -(\d+),/);
    if (!patchOffsetArr) {
        throw Error("Found no patch offset");
    }
    const patchOffset = parseInt(patchOffsetArr[1]);

    const parsedPatchLines = patchLines.map((line, index) => {
        return { line: line.slice(1), index: index + patchOffset, operation: lineToDiffOperation(line, reverse) };
    });

    // create new file with patch applied
    const newFile = oldfileLines.splice(0, patchOffset - 1);
    for (const patchLine of parsedPatchLines) {
        if (patchLine.operation === "Add") {
            newFile.push(patchLine.line);
        } else if (patchLine.operation === "Delete") {
            // Skip the line
            oldfileLines.splice(0, 1);
        } else {
            const oldLine = oldfileLines.splice(0, 1)[0];
            if (oldLine || oldLine === "") {
                newFile.push(oldLine);
                continue;
            } else if (patchLine.line === "") {
                newFile.push(patchLine.line);
                continue;
            }
        }
    }
    newFile.push(...oldfileLines);
    return newFile.join("\n");
}

function lineToDiffOperation(line: string, reverse: boolean): DiffOperation {
    if (!line || line.startsWith(" ") || line.startsWith("\\ No newline")) {
        return "NoOp";
    } else if (line.startsWith("+") || (line.startsWith("-") && reverse)) {
        return "Add";
    } else if (line.startsWith("-") || (line.startsWith("+") && reverse)) {
        return "Delete";
    } else {
        throw Error("Incorrect formatted string: " + line);
    }
}