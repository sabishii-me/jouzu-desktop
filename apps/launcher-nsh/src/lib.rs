//! Jouzu Desktop on NSH. The backend modules keep the baseline crate-root
//! paths (`crate::runtime`, `crate::chat`, …) through the re-export below;
//! TSX imports the bridge from `jouzu-desktop/native`.

mod backend;
pub use backend::*;

use nsh_core::prelude::*;

/// The crate's UI set (`nsh.json` `"rust"`): the launcher backend bridge.
#[native_module("jouzu-desktop/native")]
fn native(registry: &mut Registry) {
    registry
        .module::<backend::bridge::Backend>()
        .module::<backend::bridge::Events>();
}