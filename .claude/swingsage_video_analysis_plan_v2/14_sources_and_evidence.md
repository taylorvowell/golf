# 14 - Sources, Evidence Quality, and Licensing Notes

## 1. SwingSage source material

The implementation plan is grounded in:

1. the supplied current-system problem brief dated 2026-08-26;
2. the prior SwingSage deep-research architecture report;
3. a second independent AI research proposal supplied for comparison;
4. the updated description of the current pre-upload audio trim flow;
5. cross-checking of the most important external technical claims.

The `reference/` folder contains source snapshots used during synthesis.

## 2. Primary external sources worth retaining

### CADDIE, CVsports Workshop at CVPR 2026

Golf-specific compact club pose estimation and sparse detector interval experiments.

- Paper: https://openaccess.thecvf.com/content/CVPR2026W/CVsports/html/Jung_CADDIE_Compact_Adaptive_Detection-Driven_Inference_for_Real-Time_Golf_Club_Pose_CVPRW_2026_paper.html
- Project: https://cjung5.github.io/CADDIE/
- Repository: https://github.com/cjung5/CADDIE

Use as architectural evidence. Do not assume a public repository implies production weights/data have a commercial license suitable for SwingSage.

### MMPose RTMW model table

- https://github.com/open-mmlab/mmpose/blob/main/configs/wholebody_2d_keypoint/rtmpose/cocktail14/rtmw_cocktail14.md

Important correction: at 384x288, a reported 76.1 value is body AP in the official table, not the whole-body AP. Whole-body AP is lower. Generic AP is not the SwingSage product metric.

### RTMPose

- https://arxiv.org/abs/2303.07399

Useful as a runtime/model candidate. Published speed on other hardware is not a guarantee on Modal L4 or for SwingSage's whole-body contract.

### RTMO

- https://arxiv.org/abs/2312.07526

Useful as a one-stage pose/person candidate. Must be validated against required keypoints and golf geometry.

### GolfDB / SwingNet

- https://openaccess.thecvf.com/content_CVPRW_2019/html/CVSports/McNally_GolfDB_A_Video_Database_for_Golf_Swing_Sequencing_CVPRW_2019_paper.html
- https://github.com/wmcnally/golfdb

Useful as a golf-specific coarse event baseline. The dataset/repository licensing must be reviewed before commercial training use. Do not assume research availability equals commercial permission.

### ByteTrack

- https://arxiv.org/abs/2110.06864

Useful concept: low-confidence detections can still contain true objects and should not always be discarded before association.

### OC-SORT

- https://arxiv.org/abs/2203.14360

Useful as a candidate short-occlusion association experiment. Not golf-specific.

### NVIDIA video decode and TensorRT documentation

- https://developer.nvidia.com/video-codec-sdk
- https://docs.nvidia.com/deeplearning/tensorrt/

Supports GPU decode and batching/runtime optimization as benchmark paths. Does not establish SwingSage's exact speedup.

### Modal documentation

- https://modal.com/docs/guide/gpu
- https://modal.com/docs/guide/cold-start
- https://modal.com/docs/guide/scale
- https://modal.com/pricing

Use current docs/pricing when implementing or forecasting. Prices and features can change.

### Android MediaMetadataRetriever

- https://developer.android.com/reference/android/media/MediaMetadataRetriever

Relevant to client-side metadata/scaled-frame experiments. Implementation feasibility and performance must still be measured on target devices.

### FFmpeg

- https://ffmpeg.org/ffmpeg.html
- https://ffmpeg.org/ffprobe.html

Used for media probing/remux/transcode behavior and timeline validation.

## 3. Claims treated as verified directionally

- Adaptive per-subsystem sampling is technically viable and strongly preferable to uniform every-model/every-frame processing.
- Golf-specific club pose is a more relevant target than only a head box.
- Sparse global club localization plus dense local/crop geometry is supported by CADDIE's reported detector-interval results.
- GPU-resident decode and batched inference are valid optimization paths.
- Low-confidence detections can be useful association evidence.
- GolfDB/SwingNet is a useful golf-specific event baseline.
- Audio should be considered a timing witness with physical/device offsets, not automatically exact visual ground truth.

## 4. Claims intentionally treated as hypotheses until measured

- 5x to 20x pose speedup from TensorRT/batching.
- sub-$0.02 total 240 fps analysis cost.
- 30/60 Hz body cadence is always sufficient.
- exact detector stride of 5 frames is optimal for SwingSage.
- any specific tracker is superior for the club.
- audio can locate impact to +/-1 frame at 240 fps in general conditions.
- curved/physics gap reconstruction improves the true club path.
- a permanently warm GPU is cost-optimal.

These belong in the experiment plan, not product requirements.

## 5. Commercial-data caution

Potential external golf datasets may carry non-commercial or research-only terms. Before using any external data to train a production model:

1. record the dataset license/version;
2. verify commercial model-training rights;
3. record attribution obligations;
4. verify whether derived weights can be distributed/used commercially;
5. have legal/licensing review where terms are unclear.

The safest long-term strategy is a consented SwingSage-owned training corpus.
