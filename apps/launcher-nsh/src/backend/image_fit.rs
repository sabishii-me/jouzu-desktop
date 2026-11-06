//! The send-budget image fitter. The baseline re-encoded through a browser
//! canvas to WebP; NSH has no canvas, so the same shrink loop runs here on the
//! native image codecs and produces JPEG. The budget constants match
//! chat-attachments.ts (200 KiB of base64 per image).

use base64::Engine;
use std::io::Cursor;

const MAX_SEND_IMAGE_BASE64: usize = 200 * 1024;
const MAX_EDGE: u32 = 1536;
const MIN_SCALE: f32 = 0.2;

fn base64_len(bytes: usize) -> usize {
    bytes.div_ceil(3) * 4
}

/// Shrink an oversized image until one message stays inside the runtime's
/// budget. Answers `{ data, mimeType }` with base64 bytes.
pub fn fit_send(data: &str, mime_type: &str) -> Result<serde_json::Value, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|_| "This image could not be read.".to_string())?;
    if base64_len(bytes.len()) <= MAX_SEND_IMAGE_BASE64 {
        return Ok(serde_json::json!({ "data": data, "mimeType": mime_type }));
    }
    // Re-encoding a still GIF would drop the animation; refuse huge ones as the baseline did.
    if mime_type == "image/gif" {
        return Err("This GIF is too large to send. Use a smaller GIF or a still image.".into());
    }
    let image = image::load_from_memory(&bytes).map_err(|_| "This image could not be read.".to_string())?;
    let longest = image.width().max(image.height()).max(1);
    let mut scale = (MAX_EDGE as f32 / longest as f32).min(1.0);
    for _ in 0..8 {
        let width = ((image.width() as f32 * scale).round() as u32).max(1);
        let height = ((image.height() as f32 * scale).round() as u32).max(1);
        let resized = image.resize_exact(width, height, image::imageops::FilterType::Triangle);
        let mut encoded = Cursor::new(Vec::new());
        let rgb = resized.to_rgb8();
        let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut encoded, 85);
        if rgb.write_with_encoder(encoder).is_ok() {
            let bytes = encoded.into_inner();
            if base64_len(bytes.len()) <= MAX_SEND_IMAGE_BASE64 {
                return Ok(serde_json::json!({
                    "data": base64::engine::general_purpose::STANDARD.encode(bytes),
                    "mimeType": "image/jpeg",
                }));
            }
        }
        if scale <= MIN_SCALE {
            break;
        }
        scale *= 0.8;
    }
    Err("This image is too large to send. Crop it or choose a smaller one.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn small_images_pass_through_unchanged() {
        let data = base64::engine::general_purpose::STANDARD.encode([1u8, 2, 3]);
        let result = fit_send(&data, "image/png").unwrap();
        assert_eq!(result["data"], data);
        assert_eq!(result["mimeType"], "image/png");
    }

    #[test]
    fn oversized_gifs_are_refused() {
        let data = base64::engine::general_purpose::STANDARD.encode(vec![0u8; MAX_SEND_IMAGE_BASE64]);
        let error = fit_send(&data, "image/gif").unwrap_err();
        assert!(error.contains("GIF"));
    }

    #[test]
    fn a_large_photograph_fits_the_budget_as_jpeg() {
        // A noisy photograph-like image that cannot stay under the budget raw.
        let mut dynamic = image::RgbImage::new(2400, 1600);
        for (index, pixel) in dynamic.pixels_mut().enumerate() {
            *pixel = image::Rgb([
                (index % 251) as u8,
                (index / 251 % 251) as u8,
                (index / 63001 % 251) as u8,
            ]);
        }
        let mut png = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(dynamic).write_to(&mut png, image::ImageFormat::Png).unwrap();
        let data = base64::engine::general_purpose::STANDARD.encode(png.into_inner());
        let result = fit_send(&data, "image/png").unwrap();
        assert_eq!(result["mimeType"], "image/jpeg");
        assert!(result["data"].as_str().unwrap().len() <= MAX_SEND_IMAGE_BASE64);
    }
}