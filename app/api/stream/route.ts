import { type NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const file = formData.get('frame') as File;

        if (!file) {
            return NextResponse.json({ error: 'No frame received' }, { status: 400 });
        }

        // For now, we just acknowledge receipt
        // You can add processing logic here later
        console.log(`Received frame: ${file.size} bytes, type: ${file.type}`);

        return NextResponse.json({
            success: true,
            message: 'Frame received',
            size: file.size
        });
    } catch (error) {
        console.error('Error processing frame:', error);
        return NextResponse.json(
            { error: 'Failed to process frame' },
            { status: 500 }
        );
    }
}

