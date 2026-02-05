################################
# PDF to Images Conversion
################################
import os
import fitz
from PIL import Image

def pdf_to_images(
    pdf_path,
    output_dir,
    book_name = None,       # folder name for this book
    page_range=None,        # tuple like (start, end) — 1-indexed inclusive
    page_list=None,         # list like [1, 5, 9]
    progress_bar=None
):
    """
    Convert selected PDF pages to images.

    Args:
        pdf_path (str): Path to PDF file
        output_dir (str): Root output directory
        book_name (str): Folder name for this book
        page_range (tuple): (start, end) inclusive page range (1-indexed)
        page_list (list): explicit page numbers (1-indexed)
        progress_bar: optional tqdm progress bar
    """
    # Auto-derive book name if not provided
    if book_name is None:
        book_name = os.path.splitext(os.path.basename(pdf_path))[0]

    # Create book-specific folder
    book_folder = os.path.join(output_dir, book_name)
    os.makedirs(book_folder, exist_ok=True)

    pdf_doc = fitz.open(pdf_path)
    total_pages = len(pdf_doc)

    image_counter = 1
    processed_pages = 0

    # -------------------------
    # Determine pages to process
    # -------------------------

    if page_list is not None:
        pages_to_process = [
            p - 1 for p in page_list
            if 1 <= p <= total_pages
        ]

    elif page_range is not None:
        start, end = page_range
        start = max(1, start)
        end = min(total_pages, end)
        pages_to_process = list(range(start - 1, end))

    else:
        pages_to_process = list(range(total_pages))

    # -------------------------
    # Progress bar info
    # -------------------------

    if progress_bar:
        progress_bar.set_postfix({
            "Status": f"{book_name}: {len(pages_to_process)} pages"
        })

    # -------------------------
    # Process pages
    # -------------------------

    for page_num in pages_to_process:
        page = pdf_doc.load_page(page_num)
        pix = page.get_pixmap()
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

        # ---- Keep your cropping logic EXACT ----
        if img.width > img.height * 1.19:
            left = img.crop((0, 0, img.width // 2, img.height))
            right = img.crop((img.width // 2, 0, img.width, img.height))

            left.save(
                os.path.join(book_folder, f"page{image_counter}.png"),
                format="PNG"
            )
            image_counter += 1

            right.save(
                os.path.join(book_folder, f"page{image_counter}.png"),
                format="PNG"
            )
            image_counter += 1

        else:
            img.save(
                os.path.join(book_folder, f"page{image_counter}.png"),
                format="PNG"
            )
            image_counter += 1

        processed_pages += 1

        if progress_bar:
            progress_bar.update(1)

    pdf_doc.close()

    if progress_bar:
        progress_bar.set_postfix({
            "Status": f"{book_name}: done ({image_counter - 1} images)"
        })

#############################
# Sample Image Display
#############################
import matplotlib.pyplot as plt

def display_sample(image_path):

    if os.path.exists(image_path):
        img = Image.open(image_path)
        plt.figure(figsize=(4, 5))
        plt.imshow(img)
        plt.axis("off")
        plt.title(f"Sample Image: {os.path.basename(image_path)}")
        plt.show()
    else:
        print(f"Image {os.path.basename(image_path)} not found.\n")
    
##############################
# Preprocessing for OCR
##############################
import os
import cv2
import numpy as np
from PIL import Image
# Optional — only needed for some methods
from skimage import restoration, exposure


def convert_to_grayscale(image):
    if len(image.shape) == 3:
        return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    return image

def correct_skew(image):
    is_color = len(image.shape) == 3
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if is_color else image.copy()

    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_OTSU)

    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return image

    largest = max(contours, key=cv2.contourArea)
    angle = cv2.minAreaRect(largest)[-1]

    if angle < -45:
        angle += 90
    elif angle > 45:
        angle -= 90

    h, w = image.shape[:2]
    M = cv2.getRotationMatrix2D((w//2, h//2), angle, 1.0)

    return cv2.warpAffine(
        image, M, (w, h),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_REPLICATE
    )

def normalize_image(image):
    return cv2.normalize(image, None, 0, 255, cv2.NORM_MINMAX)


def denoise_image(image, method="nlm"):
    image = image.astype(np.uint8)

    if method == "bilateral":
        return cv2.bilateralFilter(image, 9, 75, 75)

    if method == "nlm":
        if len(image.shape) == 3:
            return cv2.fastNlMeansDenoisingColored(image, None, 10, 10, 7, 21)
        return cv2.fastNlMeansDenoising(image, None, 10, 7, 21)

    return image


def denoise_image(image, method="nlm"):
    image = image.astype(np.uint8)

    if method == "bilateral":
        return cv2.bilateralFilter(image, 9, 75, 75)

    if method == "nlm":
        if len(image.shape) == 3:
            return cv2.fastNlMeansDenoisingColored(image, None, 10, 10, 7, 21)
        return cv2.fastNlMeansDenoising(image, None, 10, 7, 21)

    return image


def enhance_contrast(image, method="clahe"):
    if method != "clahe":
        return image

    clahe = cv2.createCLAHE(2.0, (8,8))

    if len(image.shape) == 3:
        lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
        l,a,b = cv2.split(lab)
        l = clahe.apply(l)
        return cv2.cvtColor(cv2.merge([l,a,b]), cv2.COLOR_LAB2BGR)

    return clahe.apply(image)


def binarize_image(image, method="otsu"):
    gray = convert_to_grayscale(image)

    if method == "adaptive":
        return cv2.adaptiveThreshold(
            gray,255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY,15,8
        )

    _, binary = cv2.threshold(gray,0,255,cv2.THRESH_BINARY+cv2.THRESH_OTSU)
    return binary


def morphological_operations(image, operation="open", k=(2,2), iterations=1):
    kernel = np.ones(k, np.uint8)

    ops = {
        "open": cv2.MORPH_OPEN,
        "close": cv2.MORPH_CLOSE
    }

    if operation in ops:
        return cv2.morphologyEx(image, ops[operation], kernel, iterations)

    if operation == "dilate":
        return cv2.dilate(image, kernel, iterations)

    if operation == "erode":
        return cv2.erode(image, kernel, iterations)

    return image


OP_REGISTRY = {
    "grayscale": convert_to_grayscale,
    "deskew": correct_skew,
    "normalize": normalize_image,
    "denoise": denoise_image,
    "contrast": enhance_contrast,
    "binarize": binarize_image,
    "morph": morphological_operations
}

def apply_operation(image, op_name, params=None):
    if op_name not in OP_REGISTRY:
        raise ValueError(f"Unknown operation: {op_name}")

    func = OP_REGISTRY[op_name]

    if params:
        return func(image, **params)
    return func(image)

def run_pipeline(image, pipeline):
    result = image

    for step in pipeline:
        op = step["op"]
        params = step.get("params", {})
        result = apply_operation(result, op, params)

    return result

def expand_pages(spec):
    pages = set()

    for item in spec:
        if isinstance(item, tuple):
            pages.update(range(item[0], item[1]+1))
        else:
            pages.add(item)

    return pages

def process_image_folder(
    input_dir,
    output_dir,
    default_pipeline,
    page_pipelines=None,
    ext=".png"
):

    os.makedirs(output_dir, exist_ok=True)

    # Expand rules
    page_map = {}

    if page_pipelines:
        for spec, pipeline in page_pipelines.items():
            pages = expand_pages([spec] if not isinstance(spec,list) else spec)
            for p in pages:
                page_map[p] = pipeline

    files = sorted([f for f in os.listdir(input_dir) if f.endswith(ext)])

    for idx, fname in enumerate(files, start=1):

        path = os.path.join(input_dir, fname)
        image = cv2.imread(path)

        if image is None:
            print("Skip:", fname)
            continue

        pipeline = page_map.get(idx, default_pipeline)

        processed = run_pipeline(image, pipeline)

        out = os.path.join(output_dir, fname)
        cv2.imwrite(out, processed)

        print(f"Page {idx} processed")

