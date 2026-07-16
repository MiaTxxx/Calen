pub(crate) fn encode(rows: &[Vec<String>]) -> String {
    let mut output = String::new();
    for row in rows {
        for (index, field) in row.iter().enumerate() {
            if index > 0 {
                output.push(',');
            }
            output.push_str(&escape(field));
        }
        output.push_str("\r\n");
    }
    output
}

fn escape(value: &str) -> String {
    if value.contains([',', '"', '\r', '\n']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

pub(crate) fn decode(input: &str) -> Result<Vec<Vec<String>>, String> {
    let input = input.strip_prefix('\u{feff}').unwrap_or(input);
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut chars = input.chars().peekable();
    let mut quoted = false;

    while let Some(ch) = chars.next() {
        if quoted {
            if ch == '"' {
                if chars.peek() == Some(&'"') {
                    chars.next();
                    field.push('"');
                } else {
                    quoted = false;
                }
            } else {
                field.push(ch);
            }
            continue;
        }

        match ch {
            '"' if field.is_empty() => quoted = true,
            ',' => row.push(std::mem::take(&mut field)),
            '\r' => {
                if chars.peek() == Some(&'\n') {
                    chars.next();
                }
                row.push(std::mem::take(&mut field));
                if !is_blank(&row) {
                    rows.push(std::mem::take(&mut row));
                } else {
                    row.clear();
                }
            }
            '\n' => {
                row.push(std::mem::take(&mut field));
                if !is_blank(&row) {
                    rows.push(std::mem::take(&mut row));
                } else {
                    row.clear();
                }
            }
            '"' => return Err("invalid quote in CSV field".to_string()),
            _ => field.push(ch),
        }
    }

    if quoted {
        return Err("unterminated quoted CSV field".to_string());
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        if !is_blank(&row) {
            rows.push(row);
        }
    }
    Ok(rows)
}

fn is_blank(row: &[String]) -> bool {
    row.iter().all(|value| value.trim().is_empty())
}
