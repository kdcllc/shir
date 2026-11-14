//! Launch-smoke contract: with `SHIR_SMOKE=1` the app prints [`READY_MARKER`] once the
//! frontend has mounted and emitted [`UI_READY_EVENT`], stays alive for [`SMOKE_DWELL`],
//! then exits 0.

use std::time::Duration;

/// How long the app stays alive after the ready marker in smoke mode.
pub const SMOKE_DWELL: Duration = Duration::from_secs(10);

/// The exact stdout line printed when the frontend has signalled that React mounted.
pub const READY_MARKER: &str = "SHIR_READY";

/// Event the frontend emits from a mounted component; the first one triggers [`READY_MARKER`].
pub const UI_READY_EVENT: &str = "shir://ui-ready";

/// Smoke mode is on only when `SHIR_SMOKE` is exactly `1`.
pub fn is_smoke_mode(value: Option<&str>) -> bool {
    value == Some("1")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_enables_smoke_mode() {
        assert!(is_smoke_mode(Some("1")));
    }

    #[test]
    fn other_values_do_not_enable_smoke_mode() {
        assert!(!is_smoke_mode(None));
        assert!(!is_smoke_mode(Some("0")));
        assert!(!is_smoke_mode(Some("")));
        assert!(!is_smoke_mode(Some("true")));
    }

    #[test]
    fn dwell_is_ten_seconds() {
        assert_eq!(SMOKE_DWELL, Duration::from_secs(10));
    }

    #[test]
    fn ready_marker_is_frozen() {
        assert_eq!(READY_MARKER, "SHIR_READY");
    }

    #[test]
    fn ui_ready_event_is_frozen() {
        assert_eq!(UI_READY_EVENT, "shir://ui-ready");
    }
}
