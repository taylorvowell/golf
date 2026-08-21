# 13. Research Sources

This file collects the primary technical sources behind the design. Cloud pricing is a snapshot and must be rechecked before production decisions.

## Golf swing temporal detection

**GolfDB: A Video Database for Golf Swing Sequencing (CVPR Workshops 2019)**  
https://openaccess.thecvf.com/content_CVPRW_2019/papers/CVSports/McNally_GolfDB_A_Video_Database_for_Golf_Swing_Sequencing_CVPRW_2019_paper.pdf

Useful because:
- 1,400 HD golf swing videos
- annotated swing events
- SwingNet temporal sequencing architecture
- demonstrates machine-learning recognition of address/backswing/impact/follow-through phases

Caveat:
- dataset clips are swing-centric and should not be treated as evidence that arbitrary 20-second raw phone recordings can achieve the same event accuracy without additional candidate detection/context.

## Pose

**Google MediaPipe Pose Landmarker**  
https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker

Useful because:
- body landmarks
- image/video/live stream modes
- mobile-oriented pose stack
- 33 body landmarks

Use:
- optional movement/pose verification, not mandatory 240 FPS inference.

## Audio onset

**Essentia Onset Detection Tutorial**  
https://essentia.upf.edu/tutorial_rhythm_onsetdetection.html

Useful because:
- onset detection functions
- spectral/high-frequency/complex onset concepts
- peak detection process

Use:
- first-stage transient candidate detection instead of a raw amplitude threshold.

## Audio embeddings

**TensorFlow YAMNet**  
https://www.tensorflow.org/hub/tutorials/yamnet

Useful as:
- rapid prototype feature/embedding model for acoustic event classification

Production recommendation:
- train/distill a smaller task-specific classifier once enough golf-range examples exist.

## Android high-speed capture

**CameraX HighSpeedVideoSessionConfig**  
https://developer.android.com/reference/androidx/camera/video/HighSpeedVideoSessionConfig

Important:
- high-speed >=120 FPS
- common rates include 120/240 FPS
- special session constraints
- preview is not necessarily high-speed even while recording is high-speed

**CameraX releases**  
https://developer.android.com/jetpack/androidx/releases/camera

Useful:
- modern CameraX support for high-speed/slow-motion recording and supported frame-rate queries.

**CameraX architecture**  
https://developer.android.com/media/camera/camerax/architecture

Useful:
- preview, image analysis, image capture, and video use-case model.

## Android trimming

**Media3 Transformer**  
https://developer.android.com/media/media3/transformer

**Transformations**  
https://developer.android.com/media/media3/transformer/transformations

Useful:
- trim
- transcode/transmux
- optimized media transformations

## iOS capture/media

**AVFoundation**  
https://developer.apple.com/av-foundation/

**AVAssetImageGenerator**  
https://developer.apple.com/documentation/avfoundation/avassetimagegenerator

Useful:
- native capture formats/high-speed configuration
- frame/thumbnail generation for review filmstrip

## Android thumbnails

**MediaMetadataRetriever**  
https://developer.android.com/reference/android/media/MediaMetadataRetriever

Useful:
- scaled frame extraction at requested times.

## Upload reliability

**AWS S3 Multipart Upload**  
https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html

Useful:
- independent part upload/retry
- restart resilience

**Google Cloud Resumable Uploads**  
https://docs.cloud.google.com/storage/docs/resumable-uploads

Useful alternative cloud reference.

## AWS pricing/architecture

**AWS Pricing / S3 tier example**  
https://aws.amazon.com/pricing/

**S3 Pricing**  
https://aws.amazon.com/s3/pricing/

**CloudFront Pricing**  
https://aws.amazon.com/cloudfront/pricing/

**CloudFront FAQ**  
https://aws.amazon.com/cloudfront/faqs/

Current pay-as-you-go free-tier reference:
- 1 TB monthly data transfer out
- 10 million HTTP/HTTPS requests

**CloudFront Flat-Rate Plans**  
https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html

**ECS Pricing**  
https://aws.amazon.com/ecs/pricing/

**Fargate Pricing**  
https://aws.amazon.com/fargate/pricing/

Important:
- per-second billing
- one-minute minimum for Linux tasks
- benchmark task-per-swing versus long-lived queue workers.
